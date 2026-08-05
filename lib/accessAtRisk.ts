/**
 * ONE shared Access At Risk definition used by the admin list AND the reminder
 * gate / automation. A student must never appear on the list with no actionable
 * reason — pending ₹0 attempts are not collections cases.
 */
import { countsTowardCapacity, isActiveEnrollment } from "./enrollmentScope";
import { formatISTDate } from "./dates";
import type { CourseEnrollment, CourseAccessOverride, InstallmentItem } from "./types";
import type { LectureAccess } from "./entitlements";
import { activeAccessGrant } from "./sms/accessReminderService";
import { enrollmentFeeStateFromEnrollment, isFeeLineOutstanding, lineRemainingAmount } from "./enrollmentFeeState";

export { countsTowardCapacity, isPhantomEnrollment, isActiveEnrollment } from "./enrollmentScope";

export type AccessAtRiskKind =
  | "schedule_blocked"
  | "schedule_grace"
  | "grant_holding";

export interface AccessAtRiskDecision {
  onList: boolean;
  kind: AccessAtRiskKind | null;
  /** Schedule status used for the decision (ignores temporary grants). */
  scheduleStatus: string;
  /** Why Remind may be disabled even when the row stays visible. */
  inactionReason: string | null;
}

/** Collections risk from schedule alone (grace / overdue-blocked). Not "expiring" full-pay windows. */
export function isScheduleCollectionsRisk(access: Pick<LectureAccess, "status" | "reason">): boolean {
  if (access.status === "grace") return true;
  if (access.status === "blocked" && access.reason === "overdue") return true;
  return false;
}

export function outstandingAmount(
  e: Pick<CourseEnrollment, "id" | "total_fee" | "amount_paid" | "schedule" | "discount_amount"> | Pick<CourseEnrollment, "total_fee" | "amount_paid">,
): number {
  if ("schedule" in e && e.schedule) {
    return enrollmentFeeStateFromEnrollment({
      id: "id" in e && e.id ? e.id : "_",
      total_fee: e.total_fee,
      schedule: e.schedule,
      discount_amount: "discount_amount" in e ? e.discount_amount : 0,
      amount_paid: e.amount_paid,
    }).outstanding;
  }
  return Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0));
}

/**
 * Shared list predicate. Requires a real paid enrollment; pending ₹0 rows with
 * phantom schedules must never appear.
 */
export function isAccessAtRiskEnrollment(input: {
  enrollment: CourseEnrollment;
  scheduleAccess: LectureAccess;
  override?: CourseAccessOverride | null;
  now?: number;
}): boolean {
  const e = input.enrollment;
  if (!isActiveEnrollment(e)) return false;
  if (e.status === "cancelled" || e.status === "transferred_out") return false;
  const owed = outstandingAmount(e);
  if (owed <= 0) return false;
  if (isScheduleCollectionsRisk(input.scheduleAccess)) return true;
  const grant = activeAccessGrant(input.override, input.now);
  return !!grant && owed > 0;
}

export function classifyAccessAtRisk(input: {
  enrollment: CourseEnrollment;
  scheduleAccess: LectureAccess;
  override?: CourseAccessOverride | null;
  now?: number;
}): AccessAtRiskDecision {
  const e = input.enrollment;
  const scheduleStatus = input.scheduleAccess.status;
  if (!isActiveEnrollment(e)) {
    return { onList: false, kind: null, scheduleStatus, inactionReason: "No paid enrollment — not a collections case" };
  }
  const owed = outstandingAmount(e);
  if (owed <= 0) {
    return { onList: false, kind: null, scheduleStatus, inactionReason: null };
  }
  const grant = activeAccessGrant(input.override, input.now);
  const scheduleRisk = isScheduleCollectionsRisk(input.scheduleAccess);
  const grantHolding = !!grant && owed > 0;
  if (!scheduleRisk && !grantHolding) {
    return { onList: false, kind: null, scheduleStatus, inactionReason: null };
  }
  const kind: AccessAtRiskKind = scheduleRisk
    ? (input.scheduleAccess.status === "grace" ? "schedule_grace" : "schedule_blocked")
    : "grant_holding";
  return { onList: true, kind, scheduleStatus, inactionReason: null };
}

/** All unpaid dated installments with remaining > 0, sorted by due date ascending.
 *  Surfaces amountDue (base + carried_in − allocated) on `.amount` for SMS/ladder. */
export function unpaidDatedLines(schedule: InstallmentItem[] | null | undefined): InstallmentItem[] {
  return (schedule || [])
    .filter((s) => isFeeLineOutstanding(s) && s.due && lineRemainingAmount(s) > 0)
    .map((s) => ({ ...s, amount: lineRemainingAmount(s) }))
    .slice()
    .sort((a, b) => Date.parse(a.due as string) - Date.parse(b.due as string));
}

/** Next unpaid dated installment with amount > 0 (installment/seat/full), for staff copy. */
export function nextUnpaidDatedLine(schedule: InstallmentItem[] | null | undefined): InstallmentItem | null {
  return unpaidDatedLines(schedule)[0] ?? null;
}

/**
 * Whole days past the gating unpaid line's due date (same line lectureAccess uses).
 * 0 when not past due.
 */
export function daysOverdueFromSchedule(enrollment: Pick<CourseEnrollment, "schedule">, now = Date.now()): number {
  const line = nextUnpaidDatedLine(enrollment.schedule);
  if (!line?.due) return 0;
  const due = Date.parse(line.due);
  if (!Number.isFinite(due) || now <= due) return 0;
  return Math.floor((now - due) / 86_400_000);
}

/**
 * Human reason when Remind should be disabled on a row. Prefer concrete next-due
 * / grant / opt-out / needs_call copy over a bare "excluded".
 */
export function humanRemindInaction(input: {
  blockReason: string | null | undefined;
  blockDetail?: string | null;
  needsCall?: boolean;
  needsCallReason?: string | null;
  grantExpiresAt?: string | null;
  nextUnpaid?: InstallmentItem | null;
  scheduleStatus?: string | null;
}): string | null {
  if (input.needsCall) {
    return input.needsCallReason
      ? `Flagged for call — ${input.needsCallReason}`
      : "Flagged for call — payment failures";
  }
  const br = input.blockReason || "";
  if (br === "opted_out") return "Opted out";
  if (br === "missing_phone" || br === "invalid_mobile") return "No phone on record";
  if (br === "cap_reached" || br === "needs_call") {
    return input.needsCallReason || "Reminder cap reached";
  }
  if (br === "not_access_risk" || br === "no_unpaid_installment") {
    const next = input.nextUnpaid;
    if (next?.due) {
      return `Not due yet — ${next.label} due ${formatISTDate(next.due)}`;
    }
    return "Not due yet — current on plan";
  }
  if (br === "no_active_enrollment") return "No paid enrollment — not a collections case";
  if (br === "days_not_positive" && input.grantExpiresAt) {
    return `Access granted until ${formatISTDate(input.grantExpiresAt)}`;
  }
  if (input.grantExpiresAt && input.scheduleStatus === "active") {
    return `Access granted until ${formatISTDate(input.grantExpiresAt)}`;
  }
  if (input.blockDetail) return input.blockDetail;
  if (br) return br.replace(/_/g, " ");
  return null;
}
