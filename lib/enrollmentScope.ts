/**
 * Shared enrollment scope — ONE definition of what counts as a real enrolment
 * vs a checkout phantom. Every surface that counts seats, revenue, or access
 * must use these helpers so filters cannot drift apart.
 */
import type { InstallmentItem, CourseEnrollment } from "./types";
import { isActiveEnrollment, isAttemptEnrollment } from "./installments";

export { isActiveEnrollment, isAttemptEnrollment };

/** Real paid/comp enrolment — seats, outstanding, dashboards. */
export function countsTowardCapacity(e: Pick<CourseEnrollment, "status" | "amount_paid">): boolean {
  return isActiveEnrollment(e);
}

/** Abandoned checkout / failed payment intent — never seats, never access risk. */
export function isPhantomEnrollment(e: Pick<CourseEnrollment, "status" | "amount_paid">): boolean {
  return isAttemptEnrollment(e);
}

/**
 * Persist plan amounts for checkout, but strip every due/grace date so a ₹0 row
 * can never enter grace/blocked or drive collections.
 */
export function scheduleAsCheckoutIntent(schedule: InstallmentItem[]): InstallmentItem[] {
  return schedule.map((s) => ({
    ...s,
    due: null,
    grace: null,
  }));
}

/** True when an installment schedule has no dated outstanding lines. */
export function scheduleHasDatedDues(schedule: InstallmentItem[] | null | undefined): boolean {
  return (schedule || []).some((s) => !!s.due && !s.paid && s.status !== "cancelled" && s.status !== "waived");
}
