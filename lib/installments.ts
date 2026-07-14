import { addDaysISO, addMonthsISO, formatISTDate } from "./dates";
import type {
  Course,
  CourseEmiConfig,
  CourseEnrollment,
  InstallmentItem,
} from "./types";

/** Defaults for the seat + EMI plan, applied on top of admin config. */
export const EMI_DEFAULTS = {
  allow_full: true,
  allow_custom_seat: false,
  installment_counts: [3, 6, 10],
  first_interval_days: 7,
  interval_months: 1,
};

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
}

/**
 * Build the full payment schedule for a seat + EMI plan.
 * Guarantees: seat + sum(installments) === total exactly (remainder on the LAST
 * installment). Due dates: installment 1 = booking + firstIntervalDays, then
 * each subsequent + intervalMonths (IST calendar).
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

  const firstDue = addDaysISO(opts.bookingISO, opts.firstIntervalDays);
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
}): InstallmentItem[] {
  const total = Math.max(0, Math.round(opts.payInFull));
  const seat = Math.min(Math.max(0, Math.round(opts.seatAmount)), Math.max(0, total - 1));
  const balance = total - seat;
  return [
    { no: 0, kind: "seat", label: opts.seatLabel || "Book Your Seat", amount: seat, due: null, paid: false },
    { no: 1, kind: "installment", label: "Remaining balance", amount: balance, due: addDaysISO(opts.bookingISO, opts.firstIntervalDays), paid: false },
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

function buildBatchLabel(batchStart: string | null, timings?: string[] | null): string | null {
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
  let totalFee: number;
  let installmentCount = 0;

  if (input.plan === "emi") {
    if (!cfg.enabled) return { ok: false, error: "EMI is not available for this course." };
    const count = Math.round(Number(input.installmentCount) || 0);
    if (!cfg.installmentCounts.includes(count)) return { ok: false, error: "Invalid installment plan." };
    totalFee = standardTotal;
    planType = "emi";
    installmentCount = count;

    if (input.bookSeat && seatConfigured) {
      const seat = resolveSeat(standardTotal);
      if (typeof seat === "string") return { ok: false, error: seat };
      schedule = buildSchedule({
        total: standardTotal,
        seatAmount: seat,
        count,
        bookingISO,
        firstIntervalDays: cfg.firstIntervalDays,
        intervalMonths: cfg.intervalMonths,
      });
      firstAmount = seat;
      firstKind = "seat";
      firstInstallmentNo = 0;
    } else {
      schedule = buildInstallmentOnlySchedule({ total: standardTotal, count, bookingISO, intervalMonths: cfg.intervalMonths });
      firstAmount = schedule[0].amount;
      firstKind = "installment";
      firstInstallmentNo = 1;
    }
  } else {
    if (!cfg.allowFull && cfg.enabled) return { ok: false, error: "Full payment is not available for this course." };
    totalFee = payInFull;
    planType = "full";

    if (input.bookSeat && seatConfigured) {
      const seat = resolveSeat(payInFull);
      if (typeof seat === "string") return { ok: false, error: seat };
      schedule = buildFullWithSeatSchedule({ payInFull, seatAmount: seat, bookingISO, firstIntervalDays: cfg.firstIntervalDays });
      firstAmount = seat;
      firstKind = "seat";
      firstInstallmentNo = 0;
      installmentCount = 1;
    } else {
      schedule = buildFullSchedule(payInFull);
      firstAmount = payInFull;
      firstKind = "full";
      firstInstallmentNo = 0;
    }
  }

  return {
    ok: true,
    plan: { schedule, totalFee, planType, installmentCount, batchLabel, firstAmount, firstKind, firstInstallmentNo },
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
  return (e.amount_paid || 0) > 0 || e.status === "fully_paid";
}

/** Inverse of isActiveEnrollment — a payment attempt / intent, not a real enrollment. */
export function isAttemptEnrollment(e: Pick<CourseEnrollment, "status" | "amount_paid">): boolean {
  return !isActiveEnrollment(e);
}

/** A line the student still owes money on (drives next-payable + 15-day access grace). */
export function isLineOutstanding(item: Pick<InstallmentItem, "paid" | "status">): boolean {
  return !item.paid && !isLineCancelledOrWaived(item);
}

export interface EnrollmentDerived {
  paid: number;
  remaining: number;
  /** The next unpaid schedule item the student should pay, if any. */
  nextPayable: InstallmentItem | null;
  paidCount: number;
  installmentTotal: number;
  progressPct: number;
  isFullyPaid: boolean;
  /** True if any unpaid installment's due date has passed. */
  hasOverdue: boolean;
}

/** Derive payment progress from the schedule (schedule is the source of truth). */
export function deriveEnrollment(enr: Pick<CourseEnrollment, "total_fee" | "schedule">, now = Date.now()): EnrollmentDerived {
  const schedule = enr.schedule || [];
  const paid = schedule.filter((s) => s.paid).reduce((a, s) => a + s.amount, 0);
  const remaining = Math.max(0, enr.total_fee - paid);
  // Installments that still count toward the plan (paid, or outstanding — not cancelled/waived).
  const installments = schedule.filter((s) => s.kind === "installment" && (s.paid || !isLineCancelledOrWaived(s)));
  const paidInstallments = installments.filter((s) => s.paid).length;
  const nextPayable = schedule.find((s) => isLineOutstanding(s)) || null;
  const hasOverdue = schedule.some((s) => isLineOutstanding(s) && s.due != null && new Date(s.due).getTime() < now);
  return {
    paid,
    remaining,
    nextPayable,
    paidCount: paidInstallments,
    installmentTotal: installments.length,
    progressPct: enr.total_fee > 0 ? Math.round((paid / enr.total_fee) * 100) : 0,
    isFullyPaid: remaining <= 0,
    hasOverdue,
  };
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
    (s) => isLineOutstanding(s) && s.due != null && new Date(s.due).getTime() < now,
  );
  const overdueAmount = overdueLines.reduce((a, s) => a + (s.amount || 0), 0);
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
export function installmentStatus(item: InstallmentItem, now = Date.now()): "paid" | "overdue" | "due-soon" | "upcoming" | "waived" | "cancelled" {
  if (item.paid) return "paid";
  if (item.status === "waived") return "waived";
  if (item.status === "cancelled") return "cancelled";
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
  if (d.installmentTotal === 0) return "Awaiting payment";
  const next = d.nextPayable;
  const nextStr = next ? ` · next ${formatMoney(next.amount)}${next.due ? ` on ${formatDate(next.due)}` : ""}` : "";
  return `${d.paidCount} of ${d.installmentTotal} paid${nextStr}`;
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
