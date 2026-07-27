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
  const preview = await buildBulkInstallmentReminders(ids, { overdueOnly });
  return NextResponse.json({ ok: true, preview, maxRecipients: MAX_BULK_RECIPIENTS });
}

/**
 * Send: the explicit SECOND action.
 *
 * IDEMPOTENCY. The client mints a `jobId` and reuses it across retries, a
 * double-click and a refresh. If any log already carries it, this is a replay:
 * we return that job's existing outcome and send nothing. That check is the
 * whole reason the job id is client-supplied rather than generated here — a
 * server-generated id would make every retry a fresh job.
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
  const rawIds = Array.isArray(body.enrollmentIds) ? body.enrollmentIds.filter((x: unknown) => typeof x === "string") : [];
  const jobId = typeof body.jobId === "string" && body.jobId.trim() ? body.jobId.trim() : null;
  if (!rawIds.length) return NextResponse.json({ ok: false, error: "Select at least one student." }, { status: 400 });
  if (!jobId) return NextResponse.json({ ok: false, error: "A jobId is required so a replay cannot double-send." }, { status: 400 });
  if (rawIds.length > MAX_BULK_RECIPIENTS) {
    return NextResponse.json(
      { ok: false, error: `A single job is capped at ${MAX_BULK_RECIPIENTS} recipients; ${rawIds.length} were selected.` },
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

  const overdueOnly = body.overdueOnly !== false;
  // Re-resolve from scratch. Staff may have excluded rows in the review screen,
  // so only ids they left selected are considered.
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
    allowRecentOverride: !!body.allowRepeat,
  });

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
  });
}
