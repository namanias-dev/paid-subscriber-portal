/**
 * Manual "add student" collects money in two places:
 *   1. a schedule line marked "Payment received today"
 *   2. the optional "Record initial payment" section
 *
 * Those are the same money when staff fill both in for one course.
 * Applying both creates a second PAID row (new offline reference) and
 * finalize settles the next unpaid line, so ₹25,000 becomes ₹50,000.
 *
 * This helper is the only decision for whether the second write runs.
 * It uses the existing per-reference finalize idempotency by refusing the
 * extra call — it does not invent another idempotency store.
 */

export interface ManualInitialPayment {
  courseSlug: string;
  kind: "seat" | "installment" | "full";
  installmentNo?: number | null;
  method: string;
  dateISO?: string;
  note?: string;
}

export function initialPaymentForNewEnrollment(input: {
  /** Courses whose enrollment row was created or reused by THIS request. */
  createdCourseSlugs: string[];
  /** Courses that already have at least one explicit line payment in THIS request. */
  recordedCourseSlugs: string[];
  initial: ManualInitialPayment | null;
}): { payment: ManualInitialPayment | null; skippedBecause: "none" | "not_created" | "line_already_recorded" | null } {
  const initial = input.initial;
  if (!initial?.courseSlug || !initial.method) {
    return { payment: null, skippedBecause: initial ? "none" : null };
  }
  if (!input.createdCourseSlugs.includes(initial.courseSlug)) {
    return { payment: null, skippedBecause: "not_created" };
  }
  if (input.recordedCourseSlugs.includes(initial.courseSlug)) {
    return { payment: null, skippedBecause: "line_already_recorded" };
  }
  return { payment: initial, skippedBecause: null };
}

/** Rupees this add-student request will mark paid. Each entry is one payment. */
export function collectedToday(amounts: number[]): number {
  return amounts.reduce((sum, amount) => sum + (Number.isFinite(amount) ? Math.round(amount) : 0), 0);
}
