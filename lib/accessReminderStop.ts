/**
 * Lean PAID-side reminder stop — no SMS send / session imports (client-safe chain).
 */
import { clearReminderStreak } from "./sms/installmentReminderStreak";

export async function stopRemindersOnPaid(input: {
  phone: string;
  enrollmentId?: string | null;
  courseId?: string | null;
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
}
