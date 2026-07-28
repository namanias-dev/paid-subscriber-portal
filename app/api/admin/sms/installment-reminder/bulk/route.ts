import { NextResponse } from "next/server";
import { requirePermission, currentAdminId } from "@/lib/adminGuard";
import { listLogsByCampaign } from "@/lib/sms/store";
import {
  buildBulkInstallmentReminders,
  INSTALLMENT_REMINDER_TEMPLATE_ID,
  MAX_BULK_RECIPIENTS,
} from "@/lib/sms/installmentReminderService";
import { buildFollowUpPreview, FOLLOW_UP_DELAY_MINUTES } from "@/lib/sms/installmentFollowUp";
import { sendInstallmentReminderBatch } from "@/lib/sms/installmentReminderSend";
import { resolveRetryTargets, retryTargetsAreDisjoint } from "@/lib/sms/retryTargets";

export const dynamic = "force-dynamic";

/**
 * Bulk installment reminders — review (POST) and send (PUT).
 *
 * PERMISSIONS ARE ENFORCED HERE, not in the UI. Both verbs require `send_sms`;
 * hiding the button is a courtesy, this check is the control.
 *
 * Review and send call the SAME builder as the single-student button
 * (`buildReminderFor`), so the bodies staff approved are the bodies that go out,
 * and a recipient whose resolution broke between the two clicks is refused for
 * the same named reason instead of being sent something half-rendered.
 */

/** Review: resolve + render every selected student. Never sends. */
export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.enrollmentIds) ? body.enrollmentIds.filter((x: unknown) => typeof x === "string") : [];
  if (!ids.length) {
    return NextResponse.json({ ok: false, error: "Select at least one student." }, { status: 400 });
  }
  const overdueOnly = body.overdueOnly !== false;
  // The instructions message is identical for every recipient, so the review
  // screen shows it once alongside the per-student reminders.
  const [preview, followUp] = await Promise.all([
    buildBulkInstallmentReminders(ids, { overdueOnly }),
    buildFollowUpPreview(),
  ]);
  return NextResponse.json({ ok: true, preview, followUp, maxRecipients: MAX_BULK_RECIPIENTS });
}

/**
 * Send: the explicit SECOND action.
 *
 * IDEMPOTENCY. The client mints a `jobId` and reuses it across a double-click and
 * a refresh. If any log already carries it, this is a replay: we return that job's
 * existing outcome and send nothing. That check is the whole reason the job id is
 * client-supplied rather than generated here — a server-generated id would make
 * every attempt a fresh job.
 *
 * TWO MUTUALLY EXCLUSIVE MODES.
 *   normal  — `enrollmentIds`: send to the students the staff member selected.
 *   retry   — `retryOf`: re-send ONLY to recipients of an earlier campaign whom
 *             nothing ever reached, derived from the send log.
 *
 * A retry deliberately has NO recipient parameter. The caller names the campaign
 * to repair and the server works out who that means, so a client cannot ask for a
 * retry "to these people" at all — which is precisely the bug this shape removes.
 * Supplying both is refused rather than resolved, because guessing which one was
 * meant is how a retry ends up addressing 86 people instead of 10.
 *
 * The job continues past individual failures: `sendBatch` screens and sends per
 * recipient, so one unresolvable or opted-out student is excluded with a reason
 * while everyone else still goes.
 */
export async function PUT(req: Request) {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const clientIds = Array.isArray(body.enrollmentIds) ? body.enrollmentIds.filter((x: unknown) => typeof x === "string") : [];
  const retryOf = typeof body.retryOf === "string" && body.retryOf.trim() ? body.retryOf.trim() : null;
  const jobId = typeof body.jobId === "string" && body.jobId.trim() ? body.jobId.trim() : null;

  if (!jobId) return NextResponse.json({ ok: false, error: "A jobId is required so a replay cannot double-send." }, { status: 400 });
  if (retryOf && clientIds.length) {
    return NextResponse.json(
      { ok: false, error: "A retry names a campaign, not recipients. Send either retryOf or enrollmentIds, never both." },
      { status: 400 },
    );
  }
  if (!retryOf && !clientIds.length) {
    return NextResponse.json({ ok: false, error: "Select at least one student." }, { status: 400 });
  }
  if (clientIds.length > MAX_BULK_RECIPIENTS) {
    return NextResponse.json(
      { ok: false, error: `A single job is capped at ${MAX_BULK_RECIPIENTS} recipients; ${clientIds.length} were selected.` },
      { status: 400 },
    );
  }

  // ---- idempotency: has this job already run? ----
  const existing = await listLogsByCampaign(jobId).catch(() => []);
  if (existing.length) {
    return NextResponse.json({
      ok: true,
      replay: true,
      jobId,
      requested: existing.length,
      sent: existing.filter((l) => ["SENT", "DELIVERED"].includes(l.status)).length,
      failed: existing.filter((l) => l.status === "FAILED").length,
      skipped: {},
      note: "This job already ran. Nothing was sent again.",
    });
  }

  // ---- who this job is for ----
  // In retry mode the target set comes from the log of the campaign being
  // repaired, and `clientIds` is never consulted.
  let rawIds = clientIds;
  let retrySummary: { of: string; targets: number; reached: number; skipped: Record<string, number> } | null = null;
  if (retryOf) {
    const priorLogs = await listLogsByCampaign(retryOf).catch(() => []);
    if (!priorLogs.length) {
      return NextResponse.json({ ok: false, error: "That campaign has no logs, so there is nothing to retry." }, { status: 404 });
    }
    const targets = resolveRetryTargets(priorLogs, { templateId: INSTALLMENT_REMINDER_TEMPLATE_ID });
    // Enforced HERE, at the point of use, so a future change to the resolver
    // cannot turn into a duplicate send without tripping this first.
    if (!retryTargetsAreDisjoint(targets)) {
      return NextResponse.json(
        { ok: false, error: "Refusing to retry: the target set overlaps recipients the campaign already reached." },
        { status: 500 },
      );
    }
    if (!targets.enrollmentIds.length) {
      return NextResponse.json({
        ok: true, replay: false, jobId, requested: 0, sent: 0, failed: 0, skipped: targets.skipped,
        note: "Every recipient in that campaign was reached. Nothing to retry.",
      });
    }
    rawIds = targets.enrollmentIds;
    retrySummary = { of: retryOf, targets: targets.enrollmentIds.length, reached: targets.reachedEnrollmentIds.length, skipped: targets.skipped };
  }

  const overdueOnly = body.overdueOnly !== false;

  const result = await sendInstallmentReminderBatch({
    enrollmentIds: rawIds,
    jobId,
    overdueOnly,
    actorUserId: await currentAdminId(),
    // Staff confirmed the count explicitly, and a 24h repeat is a warning by
    // design, so don't let the 30-min guard silently swallow a deliberate send.
    //
    // A RETRY NEVER OVERRIDES IT. It does not need to: the guard counts only
    // SENT/DELIVERED/QUEUED, so a recipient whose attempt FAILED is not a hit and
    // passes freely. The only thing it can block on a retry is someone who
    // genuinely received this template in the last half hour, and refusing that is
    // correct. Overriding here is what turned the old retry into 76 duplicates.
    allowRecentOverride: retryOf ? false : !!body.allowRepeat,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.detail, blockReason: result.reason, excludedByReason: result.excludedByReason },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: result.sent > 0 || result.requested === 0,
    replay: false,
    jobId,
    requested: result.requested,
    sent: result.sent,
    failed: result.failed,
    skipped: result.skipped,
    mode: result.mode,
    balance: result.balance,
    // Everything excluded before the job even started, with its reason.
    excludedByReason: result.excludedByReason,
    followUpsScheduled: result.followUpsScheduled,
    followUpDelayMinutes: FOLLOW_UP_DELAY_MINUTES,
    retryOf: retrySummary,
  });
}
