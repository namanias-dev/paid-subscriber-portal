/**
 * Lean PAID-side reminder stop — no SMS send / session imports (client-safe chain).
 */
import { clearReminderStreak } from "./sms/installmentReminderStreak";
import { appendStudentAccessEvent } from "./studentAccessEvents";

export async function stopRemindersOnPaid(input: {
  phone: string;
  enrollmentId?: string | null;
  courseId?: string | null;
  studentId?: string | null;
}): Promise<void> {
  await clearReminderStreak({
    courseEnrollmentId: input.enrollmentId ?? null,
    phone: input.phone,
    courseId: input.courseId ?? null,
  });
  const { cancelPendingFollowUpsForEnrollment } = await import("./sms/installmentFollowUp");
  if (input.enrollmentId) {
    await cancelPendingFollowUpsForEnrollment(input.enrollmentId, "installment_paid").catch(() => undefined);
  }
  await appendStudentAccessEvent({
    studentId: input.studentId ?? null,
    phone: input.phone,
    courseId: input.courseId ?? null,
    courseEnrollmentId: input.enrollmentId ?? null,
    eventType: "access_restored",
    actor: "system",
    channel: "payment",
    reason: "PAID — reminders stopped, access restored via finalize",
  });
}
