import { NextResponse } from "next/server";
import { requireAnyPermission, requirePermission } from "@/lib/adminGuard";
import { maskMobile } from "@/lib/phone";
import { cancelFollowUpByStaff, listPendingFollowUps } from "@/lib/sms/installmentFollowUp";

export const dynamic = "force-dynamic";

/**
 * Scheduled instructions follow-ups: what is still waiting (GET) and cancelling
 * one before it fires (DELETE).
 *
 * A message queued to go out in half an hour that staff can neither see nor stop
 * is worse than no queue at all, so this route exists specifically to make the
 * pending state visible and reversible.
 *
 * PERMISSIONS. Viewing follows the same broader rule as the tracking read — a
 * collections person who can see the worklist should see what is pending.
 * Cancelling changes what a student receives, so it requires `send_sms`.
 */
export async function GET() {
  if (!(await requireAnyPermission(["send_sms", "manage_payments", "view_revenue"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const pending = await listPendingFollowUps();
  return NextResponse.json({
    ok: true,
    // Masked: this list is about scheduling, and the real number is never needed
    // to decide whether to stop a send.
    followUps: pending.map((f) => ({
      id: f.id,
      maskedPhone: maskMobile(f.normalized_mobile),
      studentName: f.student_name,
      courseEnrollmentId: f.course_enrollment_id,
      installmentNo: f.installment_no,
      scheduledAt: f.scheduled_at,
      status: f.status,
      attempts: f.attempts,
      jobId: f.job_id,
    })),
  });
}

export async function DELETE(req: Request) {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : null;
  if (!id) return NextResponse.json({ ok: false, error: "Provide the follow-up id." }, { status: 400 });

  // Only a follow-up that has not fired can be cancelled, so a race with the
  // drain resolves as "already sent" rather than rewriting a send that happened.
  const cancelled = await cancelFollowUpByStaff(id);
  if (!cancelled) {
    return NextResponse.json(
      { ok: false, error: "That follow-up has already been sent, cancelled, or does not exist." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, id });
}
