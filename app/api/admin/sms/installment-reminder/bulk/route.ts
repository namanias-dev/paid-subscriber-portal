import { NextResponse } from "next/server";
import { requirePermission, currentAdminId } from "@/lib/adminGuard";
import { getCourseEnrollmentById } from "@/lib/dataProvider";
import { sendBatch } from "@/lib/sms/service";
import { listLogsByCampaign } from "@/lib/sms/store";
import {
  buildBulkInstallmentReminders,
  INSTALLMENT_REMINDER_TEMPLATE_ID,
  MAX_BULK_RECIPIENTS,
} from "@/lib/sms/installmentReminderService";
import { buildFollowUpPreview, scheduleFollowUp, FOLLOW_UP_DELAY_MINUTES } from "@/lib/sms/installmentFollowUp";
import { isRemindedStatus } from "@/lib/sms/installmentAttribution";
import { resolveRetryTargets, retryTargetsAreDisjoint } from "@/lib/sms/retryTargets";
import type { CourseEnrollment } from "@/lib/types";

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
  // Re-resolve from scratch. Staff may have excluded rows in the review screen,
  // so only ids they left selected are considered. In retry mode this is the
  // re-validation that catches anyone who paid since the original send.
  const preview = await buildBulkInstallmentReminders(rawIds, { overdueOnly });
  if (preview.blockReason) {
    return NextResponse.json({ ok: false, error: preview.blockDetail, blockReason: preview.blockReason }, { status: 409 });
  }

  const sendable = preview.previews.filter((p) => p.sendable);
  if (!sendable.length) {
    return NextResponse.json(
      { ok: false, error: "None of the selected students can be sent a reminder.", excludedByReason: preview.excludedByReason },
      { status: 409 },
    );
  }

  const enrollments = new Map<string, CourseEnrollment>();
  for (const e of await Promise.all(sendable.map((p) => getCourseEnrollmentById(p.enrollmentId)))) {
    if (e) enrollments.set(e.id, e);
  }

  const recipients = sendable.flatMap((p) => {
    const e = enrollments.get(p.enrollmentId);
    if (!e) return [];
    return [{
      mobile: e.phone,
      // The previewed values travel with the recipient so the send-time render
      // reproduces the approved body exactly, per recipient, never reused.
      variables: Object.fromEntries(p.variables.map((v) => [v.token, v.value])),
      relatedEntity: {
        student_name: e.student_name,
        course_id: e.course_id,
        user_id: e.student_id ?? null,
      },
      installmentKey: p.installmentKey,
    }];
  });

  const result = await sendBatch({
    recipients,
    templateId: INSTALLMENT_REMINDER_TEMPLATE_ID,
    sentBy: { userId: await currentAdminId(), type: "ADMIN" },
    audienceType: "installment_reminder",
    triggerEvent: "manual_installment_reminder",
    campaignId: jobId,
    // Staff confirmed the count explicitly, and a 24h repeat is a warning by
    // design, so don't let the 30-min guard silently swallow a deliberate send.
    //
    // A RETRY NEVER OVERRIDES IT. It does not need to: the 30-min guard counts
    // only SENT/DELIVERED/QUEUED, so a recipient whose attempt FAILED is not a
    // hit and passes freely. The only thing the guard can block on a retry is a
    // recipient who genuinely received this template from somewhere else in the
    // last half hour, and refusing that is correct, not an obstacle. Overriding
    // here is what turned the old retry into 76 duplicates.
    allowRecentOverride: retryOf ? false : !!body.allowRepeat,
  });

  // ---- step 2: one independent job per recipient whose reminder ACTUALLY sent ----
  // The send log is the source of truth for that, not the intent list: sendBatch
  // reports aggregate counts, and a recipient it dropped at the last moment must
  // not get a follow-up. Reading the logs this job just wrote gives the parent
  // send id, the number and the installment key that really went out.
  const followUpsScheduled = await scheduleFollowUpsForJob(jobId, sendable);

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
    excludedByReason: preview.excludedByReason,
    followUpsScheduled,
    followUpDelayMinutes: FOLLOW_UP_DELAY_MINUTES,
    retryOf: retrySummary,
  });
}

/**
 * Queue an instructions follow-up for every log in this job that reached the
 * gateway. Keyed off the log's own installment columns, so the follow-up is
 * provably about the same line the reminder named — and the unique index means a
 * re-run of this function schedules nothing new.
 */
async function scheduleFollowUpsForJob(
  jobId: string,
  sendable: { enrollmentId: string; studentName: string; installmentKey: { courseEnrollmentId: string; installmentNo: number; fingerprint: string } | null }[],
): Promise<number> {
  const logs = await listLogsByCampaign(jobId).catch(() => []);
  const actorUserId = await currentAdminId();
  const byEnrollment = new Map(sendable.map((p) => [p.enrollmentId, p]));

  let scheduled = 0;
  for (const log of logs) {
    if (!isRemindedStatus(log.status)) continue;
    if (log.template_id !== INSTALLMENT_REMINDER_TEMPLATE_ID) continue;
    if (!log.course_enrollment_id || log.installment_no == null) continue;
    const source = byEnrollment.get(log.course_enrollment_id);
    const queued = await scheduleFollowUp({
      parentSendId: log.id,
      normalizedMobile: log.normalized_mobile,
      courseEnrollmentId: log.course_enrollment_id,
      installmentNo: log.installment_no,
      installmentFingerprint: log.installment_fingerprint ?? null,
      studentName: log.student_name ?? source?.studentName ?? null,
      studentId: log.user_id ?? null,
      courseId: log.course_id ?? null,
      jobId,
      actorUserId,
    });
    if (queued.ok && !queued.duplicate) scheduled++;
  }
  return scheduled;
}
