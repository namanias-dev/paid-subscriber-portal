import { NextResponse } from "next/server";
import { requirePermission, currentAdminId } from "@/lib/adminGuard";
import { getCourseEnrollmentById } from "@/lib/dataProvider";
import { maskMobile } from "@/lib/phone";
import { sendSms } from "@/lib/sms/service";
import {
  buildInstallmentReminder,
  INSTALLMENT_REMINDER_TEMPLATE_ID,
} from "@/lib/sms/installmentReminderService";

export const dynamic = "force-dynamic";

/**
 * Quick installment reminder — preview (POST) and send (PUT).
 *
 * PERMISSIONS ARE ENFORCED HERE, not in the UI. Hiding the button is a
 * courtesy; this check is the control. Both verbs require `send_sms`, so a
 * non-admin calling the route directly with a valid enrollment id gets 401 and
 * no student data back.
 *
 * The preview and the send call the SAME builder, so the body a staff member
 * approved is the body that goes out — and if resolution has become impossible
 * between the two clicks, the send refuses for the same named reason.
 */

/** Preview: resolve + render, never sends. */
export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const enrollmentId = typeof body.enrollmentId === "string" ? body.enrollmentId : null;
  const phone = typeof body.phone === "string" ? body.phone : null;
  if (!enrollmentId && !phone) {
    return NextResponse.json({ ok: false, error: "Provide an enrollmentId or phone." }, { status: 400 });
  }

  const preview = await buildInstallmentReminder({ enrollmentId, phone });
  return NextResponse.json({ ok: true, preview });
}

/**
 * Send: the explicit SECOND click. Re-resolves from scratch and refuses unless
 * the reminder is still sendable. `sendSms` then re-applies every standing
 * safeguard (kill switch, caps, opt-out, DLT gate, dedupe) plus the hard render
 * guard, so this route can only ever narrow what is allowed, never widen it.
 */
export async function PUT(req: Request) {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const enrollmentId = typeof body.enrollmentId === "string" ? body.enrollmentId : null;
  if (!enrollmentId) {
    return NextResponse.json({ ok: false, error: "Provide an enrollmentId." }, { status: 400 });
  }

  const preview = await buildInstallmentReminder({ enrollmentId });
  if (!preview.sendable) {
    return NextResponse.json(
      { ok: false, error: preview.blockDetail || "This reminder cannot be sent.", blockReason: preview.blockReason },
      { status: 409 },
    );
  }

  const enrollment = await getCourseEnrollmentById(enrollmentId);
  if (!enrollment) return NextResponse.json({ ok: false, error: "Enrollment not found." }, { status: 404 });

  // Resolved values travel as the recipient's own variables so the send-time
  // render reproduces the previewed body exactly.
  const variables = Object.fromEntries(preview.variables.map((v) => [v.token, v.value]));

  const result = await sendSms({
    mobile: enrollment.phone,
    templateId: INSTALLMENT_REMINDER_TEMPLATE_ID,
    variables,
    relatedEntity: {
      student_name: enrollment.student_name,
      course_id: enrollment.course_id,
      user_id: enrollment.student_id ?? null,
    },
    sentBy: { userId: await currentAdminId(), type: "ADMIN" },
    triggerEvent: "manual_installment_reminder",
    audienceType: "installment_reminder",
    // Staff explicitly confirmed a repeat in the modal; the 24h notice is a
    // warning by design, so don't let the 30-min guard silently swallow it.
    allowRecentOverride: !!body.allowRepeat,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || result.skipped || "Send failed.", skipped: result.skipped },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    logId: result.logId,
    status: result.status,
    // Masked so the response body itself is never a PII leak into a browser log.
    maskedPhone: maskMobile(enrollment.phone),
    installmentNo: preview.installmentNo,
    amountDue: preview.amountDue,
  });
}
