import { addDaysISO, addMonthsISO, formatISTDate } from "./dates";
import type {
  Course,
  CourseEmiConfig,
  CourseEnrollment,
  InstallmentItem,
} from "./types";
import {
  enrollmentFeeStateFromEnrollment,
  isFeeLineOutstanding,
  isLinePartiallyPaid,
  isTrueCancelledLine,
  lineAllocatedAmount,
} from "./enrollmentFeeState";

export {
  enrollmentFeeStateFromEnrollment,
  getEnrollmentFeeState,
  assertOrderAmountWithinOutstanding,
  isFeeLineOutstanding,
  isLinePartiallyPaid,
  isTrueCancelledLine,
  lineAllocatedAmount,
} from "./enrollmentFeeState";
export type {
  EnrollmentFeeState,
  EnrollmentFeeLineState,
  EnrollmentFeeNextDue,
  FeeLineStatus,
} from "./enrollmentFeeState";

/** Defaults for the seat + EMI plan, applied on top of admin config. */
export const EMI_DEFAULTS = {
  allow_full: true,
  allow_custom_seat: false,
  installment_counts: [3, 6, 10],
  first_interval_days: 7,
  interval_months: 1,
};

/**
 * Days after batch start when installment 1 may first fall due.
 * Default 0 = on the batch start day (never before the course begins).
 */
export const BATCH_START_INSTALLMENT_OFFSET_DAYS = 0;

/**
 * Installment 1 due = MAX(booking + firstIntervalDays, batchStart + offset).
 * Falls back to booking-based date when batch start is null/unreliable.
 */
export function firstInstallmentDueISO(
  bookingISO: string,
  firstIntervalDays: number,
  batchStartISO?: string | null,
  batchOffsetDays: number = BATCH_START_INSTALLMENT_OFFSET_DAYS,
): string {
  const bookingBased = addDaysISO(bookingISO, firstIntervalDays);
  if (!batchStartISO) return bookingBased;
  const batchMs = Date.parse(batchStartISO);
  if (!Number.isFinite(batchMs)) return bookingBased;
  const batchBased = addDaysISO(batchStartISO, batchOffsetDays);
  return Date.parse(bookingBased) >= Date.parse(batchBased) ? bookingBased : batchBased;
}

export interface ResolvedEmiConfig {
  enabled: boolean;
  allowFull: boolean;
  seatAmount: number | null;
  allowCustomSeat: boolean;
  minSeatAmount: number | null;
  installmentCounts: number[];
  firstIntervalDays: number;
  intervalMonths: number;
  bestValueNote: string | null;
}

/** Normalize a course's EMI config with safe defaults (pure, no I/O). */
export function resolveEmiConfig(course: Pick<Course, "emi_config" | "price">): ResolvedEmiConfig {
  const c: CourseEmiConfig = course.emi_config || {};
  const counts = (c.installment_counts && c.installment_counts.length ? c.installment_counts : EMI_DEFAULTS.installment_counts)
    .map((n) => Math.max(1, Math.round(Number(n) || 0)))
    .filter((n, i, arr) => n >= 1 && arr.indexOf(n) === i)
    .sort((a, b) => a - b);
  const seatAmount = c.seat_amount != null && c.seat_amount !== ("" as unknown) ? Math.max(0, Math.round(Number(c.seat_amount))) : null;
  const minSeat = c.min_seat_amount != null && c.min_seat_amount !== ("" as unknown) ? Math.max(0, Math.round(Number(c.min_seat_amount))) : null;
  return {
    enabled: !!c.enabled,
    allowFull: c.allow_full !== false,
    seatAmount,
    allowCustomSeat: !!c.allow_custom_seat,
    minSeatAmount: minSeat,
    installmentCounts: counts,
    firstIntervalDays: c.first_interval_days != null ? Math.max(0, Math.round(Number(c.first_interval_days))) : EMI_DEFAULTS.first_interval_days,
    intervalMonths: c.interval_months != null ? Math.max(1, Math.round(Number(c.interval_months))) : EMI_DEFAULTS.interval_months,
    bestValueNote: c.best_value_note?.trim() || null,
  };
}

/**
 * The effective seat amount a student must pay for the seat-booking step:
 * a custom amount when allowed (clamped to [min, total-1]), else the fixed amount.
 */
export function effectiveSeatAmount(cfg: ResolvedEmiConfig, total: number, requested?: number | null): number {
  const floor = cfg.allowCustomSeat ? (cfg.minSeatAmount ?? cfg.seatAmount ?? 1) : (cfg.seatAmount ?? 1);
  const ceil = Math.max(1, total - 1);
  if (cfg.allowCustomSeat && requested != null && Number.isFinite(requested)) {
    return Math.min(ceil, Math.max(floor, Math.round(requested)));
  }
  return Math.min(ceil, Math.max(1, cfg.seatAmount ?? floor));
}

export interface BuildScheduleOpts {
  total: number;
  seatAmount: number;
  count: number;
  bookingISO: string;
  firstIntervalDays: number;
  intervalMonths: number;
  seatLabel?: string;
  /** When set, installment 1 never falls before this (batch start). */
  batchStartISO?: string | null;
}

/**
 * Build the full payment schedule for a seat + EMI plan.
 * Guarantees: seat + sum(installments) === total exactly (remainder on the LAST
 * installment). Due dates: installment 1 = MAX(booking + firstIntervalDays,
 * batch start), then each subsequent + intervalMonths (IST calendar).
 */
export function buildSchedule(opts: BuildScheduleOpts): InstallmentItem[] {
  const total = Math.max(0, Math.round(opts.total));
  const seat = Math.min(Math.max(0, Math.round(opts.seatAmount)), Math.max(0, total));
  const count = Math.max(1, Math.round(opts.count));
  const remaining = total - seat;

  const base = Math.floor(remaining / count);
  const remainder = remaining - base * count;

  const items: InstallmentItem[] = [
    {
      no: 0,
      kind: "seat",
      label: opts.seatLabel || "Book Your Seat",
      amount: seat,
      due: null,
      paid: false,
    },
  ];

  const firstDue = firstInstallmentDueISO(opts.bookingISO, opts.firstIntervalDays, opts.batchStartISO);
  for (let i = 1; i <= count; i++) {
    const isLast = i === count;
    items.push({
      no: i,
      kind: "installment",
      label: `Installment ${i} of ${count}`,
      amount: base + (isLast ? remainder : 0),
      due: i === 1 ? firstDue : addMonthsISO(firstDue, (i - 1) * opts.intervalMonths),
      paid: false,
    });
  }
  return items;
}

/** Single full-payment schedule (Pay Full Today). */
export function buildFullSchedule(total: number): InstallmentItem[] {
  return [{ no: 0, kind: "full", label: "Full Payment", amount: Math.max(0, Math.round(total)), due: null, paid: false }];
}

/**
 * The discounted one-shot total charged when paying the WHOLE fee in one go.
 * Falls back to the standard price when no (smaller) pay-in-full price is set.
 */
export function payInFullTotal(course: Pick<Course, "price" | "pay_in_full_price">): number {
  const std = Math.max(0, Math.round(course.price || 0));
  const pif = course.pay_in_full_price;
  if (pif != null && Number(pif) > 0 && Math.round(Number(pif)) < std) return Math.round(Number(pif));
  return std;
}

/**
 * Pay-in-full, but split into a seat now + a single remaining balance later.
 * Guarantees seat + balance === payInFull exactly. The balance is one
 * "installment" line so it reuses the same pay/finalize/receipt machinery.
 */
export function buildFullWithSeatSchedule(opts: {
  payInFull: number;
  seatAmount: number;
  bookingISO: string;
  firstIntervalDays: number;
  seatLabel?: string;
  batchStartISO?: string | null;
}): InstallmentItem[] {
  const total = Math.max(0, Math.round(opts.payInFull));
  const seat = Math.min(Math.max(0, Math.round(opts.seatAmount)), Math.max(0, total - 1));
  const balance = total - seat;
  return [
    { no: 0, kind: "seat", label: opts.seatLabel || "Book Your Seat", amount: seat, due: null, paid: false },
    {
      no: 1, kind: "installment", label: "Remaining balance", amount: balance,
      due: firstInstallmentDueISO(opts.bookingISO, opts.firstIntervalDays, opts.batchStartISO),
      paid: false,
    },
  ];
}

/**
 * Installments-only plan (no seat booking): the FIRST installment is due/paid
 * today, the rest follow every `intervalMonths`. Sum === total exactly
 * (remainder on the last installment).
 */
export function buildInstallmentOnlySchedule(opts: {
  total: number;
  count: number;
  bookingISO: string;
  intervalMonths: number;
}): InstallmentItem[] {
  const total = Math.max(0, Math.round(opts.total));
  const count = Math.max(1, Math.round(opts.count));
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  const items: InstallmentItem[] = [];
  for (let i = 1; i <= count; i++) {
    const isLast = i === count;
    items.push({
      no: i,
      kind: "installment",
      label: `Installment ${i} of ${count}`,
      amount: base + (isLast ? remainder : 0),
      due: i === 1 ? opts.bookingISO : addMonthsISO(opts.bookingISO, (i - 1) * opts.intervalMonths),
      paid: false,
    });
  }
  return items;
}

/**
 * Read a batch's mode(s) as an array regardless of shape. The current model is one
 * mode per batch (string), but legacy/backfilled batches may still hold an array;
 * both are normalised here so no consumer has to care. Returns [] when unset.
 */
export function batchModes(b: { mode?: import("./types").LearningMode | import("./types").LearningMode[] | null } | null | undefined): import("./types").LearningMode[] {
  if (!b || b.mode == null) return [];
  return (Array.isArray(b.mode) ? b.mode : [b.mode]).filter(Boolean) as import("./types").LearningMode[];
}

/** Read a batch's timing(s) as an array regardless of shape (string or legacy array). */
export function batchTimings(b: { timing?: string | string[] | null } | null | undefined): string[] {
  if (!b || b.timing == null) return [];
  return (Array.isArray(b.timing) ? b.timing : [b.timing]).filter(Boolean) as string[];
}

/** Display label for a batch's mode(s), e.g. "Online" or legacy "Online / Hybrid". */
export function batchModeLabel(b: { mode?: import("./types").LearningMode | import("./types").LearningMode[] | null } | null | undefined): string {
  return batchModes(b).join(" / ");
}

/** Display label for a batch's timing(s), e.g. "Morning" or legacy "Morning · Evening". */
export function batchTimingLabel(b: { timing?: string | string[] | null } | null | undefined): string {
  return batchTimings(b).join(" · ");
}

export function buildBatchLabel(batchStart: string | null, timings?: string[] | null): string | null {
  const parts: string[] = [];
  if (batchStart) parts.push(`Starts ${formatISTDate(batchStart)}`);
  if (timings && timings.length) parts.push(timings.join(" · "));
  return parts.length ? parts.join(" · ") : null;
}

export interface PlanCourseInput {
  course: Course;
  plan: "full" | "emi";
  bookSeat: boolean;
  seatAmount?: number | null;
  installmentCount?: number | null;
  bookingISO?: string;
  /**
   * PHASE 1 (default-batch fallback): when omitted — as ALL current callers do —
   * pricing/dates come from the course-level fields exactly as before. When a
   * matching batch id is supplied, that batch's price/date/mode/seats override
   * the course-level values for this plan only. An unknown id falls back to the
   * course-level fields (never throws), so behaviour can only stay the same.
   */
  batchId?: string | null;
  /**
   * Optional server-validated coupon discount in rupees. Reduces the plan total
   * before schedules are built. Seat-booking amount (when requested) stays the
   * configured seat; the discount applies to the remaining balance. Clamped so
   * payable never goes below zero.
   */
  discountRupees?: number | null;
}

/**
 * Resolve the effective course for planning. With no batchId (today's behaviour)
 * this returns the course unchanged — guaranteeing identical output. With a known
 * batchId it returns a shallow copy whose pricing/date/mode fields are overridden
 * by that batch, so every downstream helper (resolveEmiConfig, payInFullTotal,
 * buildBatchLabel) reads the batch's values without any other code change.
 */
export function effectiveCourseForBatch(course: Course, batchId?: string | null): Course {
  if (!batchId) return course;
  const batch = (course.batches || []).find((b) => b.id === batchId);
  if (!batch) return course;
  // mode/timing may be a single value (new model) or an array (legacy/backfill).
  // batchModes/batchTimings normalise both into the array shape course-level fields
  // expect, so a legacy array batch yields the SAME arrays as before (byte-for-byte).
  return {
    ...course,
    modes: batch.mode == null ? course.modes : batchModes(batch),
    batch_start: batch.start_date ?? course.batch_start,
    batch_timings: batch.timing == null ? course.batch_timings : batchTimings(batch),
    price: batch.price,
    original_price: batch.original_price ?? course.original_price,
    pay_in_full_price: batch.pay_in_full_price ?? course.pay_in_full_price,
    emi_config: batch.emi_config ?? course.emi_config,
    capacity: batch.capacity ?? course.capacity,
    seats_left: batch.seats_left ?? course.seats_left,
  };
}

export interface PlannedEnrollment {
  schedule: InstallmentItem[];
  totalFee: number;
  planType: "full" | "emi";
  installmentCount: number;
  batchLabel: string | null;
  /** The amount, kind and number of the FIRST payable line (for the initial payment). */
  firstAmount: number;
  firstKind: "seat" | "full" | "installment";
  firstInstallmentNo: number;
  /** List/original total before any coupon discount (equals totalFee when no discount). */
  originalTotalFee: number;
  /** Rupee discount actually applied (0 when none). */
  discountAmount: number;
}

/**
 * Single source of truth for turning a course + chosen plan into an enrollment
 * schedule. Used by BOTH the public checkout (create-payment) and the admin
 * add/enroll flow so a manually-added student is identical to a self-registered
 * one. Pure (no I/O); returns a discriminated result with friendly errors.
 */
export function planCourseEnrollment(
  input: PlanCourseInput
): { ok: true; plan: PlannedEnrollment } | { ok: false; error: string } {
  // With no batchId (all current callers) this is the original `course`, so the
  // entire computation below is byte-for-byte identical to the previous behaviour.
  const course = effectiveCourseForBatch(input.course, input.batchId);
  const standardTotal = Math.max(0, Math.round(course.price));
  if (standardTotal <= 0) return { ok: false, error: "This course has no payable fee." };

  const cfg = resolveEmiConfig(course);
  const payInFull = payInFullTotal(course);
  const bookingISO = input.bookingISO || new Date().toISOString();
  const seatConfigured = cfg.enabled && (cfg.seatAmount != null || cfg.allowCustomSeat);
  const batchLabel = buildBatchLabel(course.batch_start, course.batch_timings);

  const resolveSeat = (base: number): number | string => {
    const requestedSeat = input.seatAmount != null ? Math.round(Number(input.seatAmount)) : null;
    const seat = effectiveSeatAmount(cfg, base, requestedSeat);
    if (seat < 1 || seat >= base) return "Invalid seat amount.";
    const floor = cfg.allowCustomSeat ? (cfg.minSeatAmount ?? cfg.seatAmount ?? 1) : (cfg.seatAmount ?? 1);
    if (seat < floor) return "Seat amount is below the minimum.";
    return seat;
  };

  let schedule: InstallmentItem[];
  let firstAmount: number;
  let firstKind: "seat" | "full" | "installment";
  let firstInstallmentNo = 0;
  let planType: "full" | "emi";
  let originalTotalFee: number;
  let installmentCount = 0;
  let seatForPlan: number | null = null;

  if (input.plan === "emi") {
    if (!cfg.enabled) return { ok: false, error: "EMI is not available for this course." };
    const count = Math.round(Number(input.installmentCount) || 0);
    if (!cfg.installmentCounts.includes(count)) return { ok: false, error: "Invalid installment plan." };
    originalTotalFee = standardTotal;
    planType = "emi";
    installmentCount = count;

    if (input.bookSeat && seatConfigured) {
      const seat = resolveSeat(originalTotalFee);
      if (typeof seat === "string") return { ok: false, error: seat };
      seatForPlan = seat;
      firstKind = "seat";
      firstInstallmentNo = 0;
    } else {
      firstKind = "installment";
      firstInstallmentNo = 1;
    }
  } else {
    if (!cfg.allowFull && cfg.enabled) return { ok: false, error: "Full payment is not available for this course." };
    originalTotalFee = payInFull;
    planType = "full";

    if (input.bookSeat && seatConfigured) {
      const seat = resolveSeat(originalTotalFee);
      if (typeof seat === "string") return { ok: false, error: seat };
      seatForPlan = seat;
      firstKind = "seat";
      firstInstallmentNo = 0;
      installmentCount = 1;
    } else {
      firstKind = "full";
      firstInstallmentNo = 0;
    }
  }

  // Coupon discount: reduce total, keep seat amount as configured, rebuild schedule.
  const requestedDiscount = Math.max(0, Math.round(Number(input.discountRupees) || 0));
  const discountAmount = Math.min(requestedDiscount, originalTotalFee);
  const totalFee = Math.max(0, originalTotalFee - discountAmount);

  if (seatForPlan != null) {
    if (totalFee < seatForPlan) {
      return {
        ok: false,
        error: "This coupon discount exceeds the payable balance after seat booking. Remove the coupon or choose a different plan.",
      };
    }
    if (planType === "emi") {
      schedule = buildSchedule({
        total: totalFee,
        seatAmount: seatForPlan,
        count: installmentCount,
        bookingISO,
        firstIntervalDays: cfg.firstIntervalDays,
        intervalMonths: cfg.intervalMonths,
        batchStartISO: course.batch_start,
      });
    } else {
      schedule = buildFullWithSeatSchedule({
        payInFull: totalFee,
        seatAmount: seatForPlan,
        bookingISO,
        firstIntervalDays: cfg.firstIntervalDays,
        batchStartISO: course.batch_start,
      });
    }
    firstAmount = seatForPlan;
  } else if (planType === "emi") {
    schedule = buildInstallmentOnlySchedule({
      total: totalFee,
      count: installmentCount,
      bookingISO,
      intervalMonths: cfg.intervalMonths,
    });
    firstAmount = schedule[0].amount;
  } else {
    schedule = buildFullSchedule(totalFee);
    firstAmount = totalFee;
  }

  return {
    ok: true,
    plan: {
      schedule,
      totalFee,
      planType,
      installmentCount,
      batchLabel,
      firstAmount,
      firstKind,
      firstInstallmentNo,
      originalTotalFee,
      discountAmount,
    },
  };
}

/** A line removed from the plan (superseded/forgiven) — never outstanding, never blocks access. */
export function isLineCancelledOrWaived(item: Pick<InstallmentItem, "status">): boolean {
  return item.status === "cancelled" || item.status === "waived";
}

/**
 * THE source-of-truth distinction between a real enrollment and a mere payment
 * attempt. A student counts as ENROLLED in a course only when:
 *   • there is a confirmed/approved payment (amount_paid > 0 — covers seat/partial/
 *     installment/full, online OR offline/manual-approved), OR
 *   • an admin granted complimentary access (status "fully_paid" at ₹0).
 * A PENDING/VERIFYING/FAILED/ABANDONED/EXPIRED attempt (amount_paid 0, status
 * "pending") or a CANCELLED/superseded duplicate is NOT an active enrollment, so it
 * must never inflate the enrolled-courses count or outstanding. Access already
 * follows the same rule (lib/entitlements + paidCourseIdsForPhone). Partial-paid
 * students stay active (they are NOT locked out) — outstanding = fee − confirmed paid.
 */
export function isActiveEnrollment(e: Pick<CourseEnrollment, "status" | "amount_paid">): boolean {
  if (e.status === "cancelled") return false;
  // A transferred-out row is kept for history and still carries the money the
  // student paid, so without this it reads as active and its outstanding balance
  // is counted a second time alongside the row that replaced it.
  if (e.status === "transferred_out") return false;
  return (e.amount_paid || 0) > 0 || e.status === "fully_paid";
}

/**
 * Superseded by a transfer: kept as history, but no longer the live enrollment.
 * Anything that chases money or scopes a student to a batch must skip these, or
 * the student appears in two batches at once and is dunned for a plan that has
 * been replaced.
 */
export function isSupersededEnrollment(e: Pick<CourseEnrollment, "status"> & { superseded_by?: string | null }): boolean {
  return e.status === "transferred_out" || !!e.superseded_by;
}

/** Inverse of isActiveEnrollment — a payment attempt / intent, not a real enrollment. */
export function isAttemptEnrollment(e: Pick<CourseEnrollment, "status" | "amount_paid">): boolean {
  return !isActiveEnrollment(e);
}

/** A line the student still owes money on (drives next-payable + 15-day access grace). */
export function isLineOutstanding(
  item: Pick<InstallmentItem, "paid" | "status" | "amount" | "paid_amount">,
): boolean {
  return isFeeLineOutstanding(item);
}

export interface EnrollmentDerived {
  paid: number;
  remaining: number;
  /** The next unpaid schedule item the student should pay, if any. */
  nextPayable: InstallmentItem | null;
  paidCount: number;
  installmentTotal: number;
  /** True when a seat-deposit line is marked paid (display only — not folded into paidCount). */
  seatPaid: boolean;
  /** Rupees on paid seat lines (0 when none). */
  seatPaidAmount: number;
  progressPct: number;
  isFullyPaid: boolean;
  /** True if any unpaid installment's due date has passed. */
  hasOverdue: boolean;
}

/**
 * Derive payment progress from the schedule via getEnrollmentFeeState.
 * FEE STATE — do not ad-hoc sum schedule amounts / amount_paid for paid,
 * outstanding, progress, or next-due. Use getEnrollmentFeeState /
 * enrollmentFeeStateFromEnrollment, or this adapter.
 * Grep guard: tests/enrollment-fee-state/no-adhoc-sums.test.ts
 */
export function deriveEnrollment(
  enr: Pick<CourseEnrollment, "id" | "total_fee" | "schedule" | "discount_amount" | "amount_paid"> | Pick<CourseEnrollment, "total_fee" | "schedule">,
  now = Date.now(),
): EnrollmentDerived {
  const withId = {
    id: "id" in enr && enr.id ? enr.id : "_",
    total_fee: enr.total_fee,
    schedule: enr.schedule,
    discount_amount: "discount_amount" in enr ? enr.discount_amount : 0,
    amount_paid: "amount_paid" in enr ? enr.amount_paid : 0,
  };
  const s = enrollmentFeeStateFromEnrollment(withId, now);
  return {
    paid: s.netPaid,
    remaining: s.outstanding,
    nextPayable: s.nextPayableItem,
    paidCount: s.paidCount,
    installmentTotal: s.installmentTotal,
    seatPaid: s.seatPaid,
    seatPaidAmount: s.seatPaidAmount,
    progressPct: s.progressPct,
    isFullyPaid: s.isFullyPaid,
    hasOverdue: s.hasOverdue,
  };
}

/**
 * Staff-facing progress label. Seat deposit is real money and must never read as
 * "nothing paid". The installment fraction stays installment-only so "1 of 3"
 * is never ambiguous with the seat line.
 */
export function paymentProgressLabel(
  d: Pick<EnrollmentDerived, "paidCount" | "installmentTotal" | "seatPaid" | "isFullyPaid">,
): string {
  if (d.isFullyPaid) return "Fully paid";
  const frac = d.installmentTotal > 0
    ? `${d.paidCount} of ${d.installmentTotal} installments paid`
    : "Awaiting payment";
  if (d.seatPaid) return `Seat booked · ${frac}`;
  return frac;
}

export interface CollectionsDerived extends EnrollmentDerived {
  /** ₹ of outstanding (unpaid, not cancelled/waived) lines whose due date has passed. */
  overdueAmount: number;
  /** Count of outstanding installment/seat lines past their due date. */
  missedInstallments: number;
  /** Whole days since the EARLIEST overdue line's due date (0 when nothing overdue). */
  daysOverdue: number;
  /** The next payable line's due date + amount (null/0 when nothing left to pay). */
  nextDueDate: string | null;
  nextDueAmount: number;
}

/**
 * Collections/finance view of an enrollment — extends deriveEnrollment (the ONE
 * source of truth for paid/remaining) with overdue-specific figures used by the
 * Course EMI drill-in, the collections worklist and the Students summary strip.
 * Pure (no I/O). Safe on empty/thin schedules — never throws, never divides by 0.
 */
export function deriveCollections(
  enr: Pick<CourseEnrollment, "total_fee" | "schedule">,
  now = Date.now(),
): CollectionsDerived {
  const base = deriveEnrollment(enr, now);
  const schedule = enr.schedule || [];
  const overdueLines = schedule.filter(
    (s) => isLineOutstanding(s) && s.due != null && (Number(s.amount) || 0) > 0 && new Date(s.due).getTime() < now,
  );
  // Use line remainder, never full face when a partial is recorded.
  const overdueAmount = overdueLines.reduce((a, s) => {
    const rem = Math.max(0, (Number(s.amount) || 0) - lineAllocatedAmount(s));
    return a + rem;
  }, 0);
  let daysOverdue = 0;
  if (overdueLines.length > 0) {
    const earliest = Math.min(...overdueLines.map((s) => new Date(s.due as string).getTime()));
    daysOverdue = Math.max(0, Math.floor((now - earliest) / 86400000));
  }
  return {
    ...base,
    overdueAmount,
    missedInstallments: overdueLines.length,
    daysOverdue,
    nextDueDate: base.nextPayable?.due ?? null,
    nextDueAmount: base.nextPayable?.amount ?? 0,
  };
}

/** Display status for a schedule line. */
export function installmentStatus(
  item: InstallmentItem,
  now = Date.now(),
): "paid" | "partially_paid" | "overdue" | "due-soon" | "upcoming" | "waived" | "cancelled" {
  if (item.paid) return "paid";
  if (item.status === "waived") return "waived";
  if (isLinePartiallyPaid(item)) return "partially_paid";
  if (isTrueCancelledLine(item) || item.status === "cancelled") return "cancelled";
  if (item.due == null) return "due-soon";
  const t = new Date(item.due).getTime();
  if (t < now) return "overdue";
  if (t - now < 3 * 86400000) return "due-soon";
  return "upcoming";
}

/** Human installment progress summary used on receipts + dashboard. */
export function installmentsSummary(enr: Pick<CourseEnrollment, "total_fee" | "schedule">, formatMoney: (n: number) => string, formatDate: (iso: string | null) => string): string {
  const d = deriveEnrollment(enr);
  if (d.isFullyPaid) return "Fully Paid";
  if (d.installmentTotal === 0 && !d.seatPaid) return "Awaiting payment";
  const next = d.nextPayable;
  const nextStr = next ? ` · next ${formatMoney(next.amount)}${next.due ? ` on ${formatDate(next.due)}` : ""}` : "";
  const money = `${formatMoney(d.paid)} of ${formatMoney(enr.total_fee)} received`;
  return `${paymentProgressLabel(d)} · ${money}${nextStr}`;
}

/** Compute the enrollment status from its schedule. */
export function enrollmentStatusFromSchedule(
  enr: Pick<CourseEnrollment, "total_fee" | "schedule" | "plan_type">
): CourseEnrollment["status"] {
  const d = deriveEnrollment(enr);
  if (d.paid <= 0) return "pending";
  if (d.isFullyPaid) return "fully_paid";
  // Seat paid but installments outstanding.
  const seatPaid = (enr.schedule || []).some((s) => (s.kind === "seat") && s.paid);
  if (seatPaid && d.paidCount === 0) return "seat_booked";
  return "partially_paid";
}
