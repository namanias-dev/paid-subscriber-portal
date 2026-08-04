/**
 * CANCEL_REASON_LABELS — client-safe extract.
 * ReminderStatePill (client) must not import installmentFollowUp (pulls dataProvider).
 */
export const CANCEL_REASON_LABELS: Record<string, string> = {
  installment_paid: "paid",
  installment_partially_paid_then_cleared: "paid in full",
  installment_voided: "installment waived or voided",
  installment_restructured: "payment plan changed",
  enrollment_cancelled: "enrollment cancelled",
  enrollment_superseded: "moved to another batch",
  enrollment_gone: "enrollment no longer exists",
  opted_out: "opted out",
  already_instructed: "instructions already sent",
  template_inactive: "template deactivated",
  cancelled_by_staff: "cancelled by staff",
};
