import { NextResponse } from "next/server";
import { requirePermission, currentAdminId } from "@/lib/adminGuard";
import { buildBulkAccessReminders } from "@/lib/sms/accessReminderService";
import { sendAccessReminderBatch } from "@/lib/sms/accessReminderSend";
import { buildFollowUpPreview, FOLLOW_UP_DELAY_MINUTES } from "@/lib/sms/installmentFollowUp";
import { listLogsByCampaign } from "@/lib/sms/store";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

/** Bulk preview. */
export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.enrollmentIds) ? body.enrollmentIds.filter((x: unknown) => typeof x === "string") : [];
  if (!ids.length) {
    return NextResponse.json({ ok: false, error: "Select at least one student." }, { status: 400 });
  }
  const [preview, followUp] = await Promise.all([
    buildBulkAccessReminders(ids),
    buildFollowUpPreview(),
  ]);
  return NextResponse.json({ ok: true, preview, followUp });
}

/** Bulk send — jobId groups logs for follow-up scheduling. */
export async function PUT(req: Request) {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.enrollmentIds) ? body.enrollmentIds.filter((x: unknown) => typeof x === "string") : [];
  const jobId = typeof body.jobId === "string" && body.jobId ? body.jobId : `access-${randomUUID()}`;

  // Replay guard: same jobId already has logs → return prior outcome.
  const prior = await listLogsByCampaign(jobId).catch(() => []);
  if (prior.length) {
    const sent = prior.filter((l) => ["SENT", "DELIVERED", "QUEUED"].includes(l.status)).length;
    return NextResponse.json({
      ok: true, replay: true, jobId, requested: prior.length, sent,
      failed: prior.length - sent, skipped: {}, followUpsScheduled: 0,
      followUpDelayMinutes: FOLLOW_UP_DELAY_MINUTES,
      note: "This job already ran — returning prior outcome.",
    });
  }

  const result = await sendAccessReminderBatch({
    enrollmentIds: ids,
    jobId,
    actorUserId: await currentAdminId(),
    allowRecentOverride: !!body.allowRepeat,
  });

  if (!result.ok) {
    return NextResponse.json({
      ok: false, error: result.detail, kind: result.kind,
      blockReason: result.reason, excludedByReason: result.excludedByReason,
    }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    replay: false,
    jobId,
    requested: result.requested,
    sent: result.sent,
    failed: result.failed,
    skipped: result.skipped,
    excludedByReason: result.excludedByReason,
    followUpsScheduled: result.followUpsScheduled,
    followUpDelayMinutes: FOLLOW_UP_DELAY_MINUTES,
    mode: result.mode,
    balance: result.balance,
  });
}
