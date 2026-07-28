import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { listLogsByCampaign } from "@/lib/sms/store";
import { resolveRetryTargets, retryTargetsAreDisjoint } from "@/lib/sms/retryTargets";
import { sendInstallmentReminderBatch } from "@/lib/sms/installmentReminderSend";
import { INSTALLMENT_REMINDER_TEMPLATE_ID } from "@/lib/sms/installmentReminderService";
import { FOLLOW_UP_DELAY_MINUTES } from "@/lib/sms/installmentFollowUp";
import { maskMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Operator entry point for repairing a past bulk reminder campaign.
 *
 * WHY THIS EXISTS. "Retry failed only" lives inside a review session and can only
 * repair the job that session just sent. A campaign that failed hours ago has no
 * session left, so there was no way to retry it at all — and the gateway only
 * accepts calls from this deployment's addresses, so it cannot be driven from a
 * laptop either. This is the narrow, auditable way in.
 *
 * IT CANNOT DO ANYTHING BUT RETRY. There is no recipient parameter: the caller
 * names a campaign, and the target set is derived from that campaign's log by the
 * same resolver the UI retry uses, which excludes anyone the campaign reached.
 * It cannot address a fresh audience, cannot widen a campaign, and cannot override
 * the same-template guard.
 *
 * `expect` is mandatory: the caller must state how many recipients it believes
 * need repairing, and a mismatch refuses the send rather than proceeding with a
 * number nobody predicted. Combined with `cap`, an operator error surfaces as a
 * refusal instead of an unplanned broadcast.
 *
 *   POST /api/ops/sms/retry-campaign?secret=<CRON_SECRET>
 *   { "campaignId": "...", "expect": 10, "dryRun": true }
 */
const HARD_CAP = 25;

export async function POST(req: Request) {
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body.campaignId === "string" ? body.campaignId.trim() : "";
  const expect = Number.isInteger(body.expect) ? (body.expect as number) : null;
  const dryRun = body.dryRun !== false;

  if (!campaignId) return NextResponse.json({ ok: false, error: "campaignId is required." }, { status: 400 });
  if (expect === null) {
    return NextResponse.json(
      { ok: false, error: "expect is required: state how many recipients you believe need repairing." },
      { status: 400 },
    );
  }

  const priorLogs = await listLogsByCampaign(campaignId).catch(() => []);
  if (!priorLogs.length) {
    return NextResponse.json({ ok: false, error: "That campaign has no logs." }, { status: 404 });
  }

  const targets = resolveRetryTargets(priorLogs, { templateId: INSTALLMENT_REMINDER_TEMPLATE_ID });
  if (!retryTargetsAreDisjoint(targets)) {
    return NextResponse.json(
      { ok: false, error: "Refusing: the target set overlaps recipients the campaign already reached." },
      { status: 500 },
    );
  }

  // What the campaign looked like, so the caller can confirm they named the right one.
  const failedLogs = priorLogs.filter((l) => l.status === "FAILED");
  const audit = {
    campaignRows: priorLogs.length,
    reached: targets.reachedEnrollmentIds.length,
    failedRows: failedLogs.length,
    targets: targets.enrollmentIds.length,
    skipped: targets.skipped,
    targetsMasked: targets.enrollmentIds.map((id) => {
      const l = failedLogs.find((x) => x.course_enrollment_id === id);
      return { phone: maskMobile(l?.mobile ?? ""), installmentNo: l?.installment_no ?? null, previousError: l?.error_message ?? null };
    }),
  };

  if (targets.enrollmentIds.length !== expect) {
    return NextResponse.json(
      {
        ok: false,
        error: `Refusing: resolved ${targets.enrollmentIds.length} target(s) but you expected ${expect}.`,
        ...audit,
      },
      { status: 409 },
    );
  }
  if (targets.enrollmentIds.length > HARD_CAP) {
    return NextResponse.json(
      { ok: false, error: `Refusing: ${targets.enrollmentIds.length} exceeds the ${HARD_CAP}-recipient cap for this route.`, ...audit },
      { status: 409 },
    );
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, ...audit, note: "Nothing was sent. Pass dryRun:false to send." });
  }

  const jobId = `retry:${campaignId}`;
  // Replay protection: the job id is derived from the campaign, so a second call
  // for the same campaign is a no-op rather than a second round of messages.
  const existing = await listLogsByCampaign(jobId).catch(() => []);
  if (existing.length) {
    return NextResponse.json({
      ok: true, replay: true, jobId, ...audit,
      sent: existing.filter((l) => ["SENT", "DELIVERED"].includes(l.status)).length,
      failed: existing.filter((l) => l.status === "FAILED").length,
      note: "This retry already ran. Nothing was sent again.",
    });
  }

  const result = await sendInstallmentReminderBatch({
    enrollmentIds: targets.enrollmentIds,
    jobId,
    overdueOnly: body.overdueOnly !== false,
    actorUserId: null,
    // Never overridden on a retry. See the note in installmentReminderSend.
    allowRecentOverride: false,
    // Step 2 goes out exactly as it would for a reminder sent from the UI today.
    scheduleFollowUps: body.scheduleFollowUps !== false,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.detail, blockReason: result.reason, ...audit }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    jobId,
    ...audit,
    requested: result.requested,
    sent: result.sent,
    failed: result.failed,
    skipped: result.skipped,
    mode: result.mode,
    excludedByReason: result.excludedByReason,
    followUpsScheduled: result.followUpsScheduled,
    followUpDelayMinutes: FOLLOW_UP_DELAY_MINUTES,
    recipients: result.sendablePreviews.map((p) => ({
      phone: p.maskedPhone,
      installmentNo: p.installmentNo,
      amountDue: p.amountDue,
      segments: p.segments,
    })),
  });
}
