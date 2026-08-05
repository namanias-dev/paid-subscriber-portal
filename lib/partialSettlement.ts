/**
 * Partial installment settlement — carry shortfall forward as adjustment rows.
 * Never overwrite the next installment's base `amount`.
 *
 * Admin decisions on proof approval (recommendation only — never auto-executes):
 *   A accept_as_partial — allocate + carry shortfall when recommendable
 *   B record_keep_open — allocate paid_amount, leave line open (no carry)
 *   C reject — typed reason (handled by caller; no schedule write here)
 */
import type { CourseEnrollment, InstallmentItem, InstallmentLineStatus } from "./types";
import {
  enrollmentFeeStateFromEnrollment,
  lineAllocatedAmount,
  lineRemainingAmount,
} from "./enrollmentFeeState";

export type PartialProofDecision = "accept_as_partial" | "record_keep_open" | "reject";

export const PARTIAL_ACCEPT_THRESHOLD_PCT_DEFAULT = 75;

export function partialAcceptThresholdPct(): number {
  const raw = Number(process.env.PARTIAL_ACCEPT_THRESHOLD_PCT || PARTIAL_ACCEPT_THRESHOLD_PCT_DEFAULT);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 100) return PARTIAL_ACCEPT_THRESHOLD_PCT_DEFAULT;
  return Math.round(raw);
}

export function recommendPartialAccept(input: {
  lineAmount: number;
  amountReceived: number;
  thresholdPct?: number;
}): { recommend: boolean; pctOfLine: number; thresholdPct: number } {
  const thresholdPct = input.thresholdPct ?? partialAcceptThresholdPct();
  const line = Math.max(0, Math.round(input.lineAmount));
  const recv = Math.max(0, Math.round(input.amountReceived));
  const pctOfLine = line > 0 ? Math.round((100 * recv) / line) : 0;
  return { recommend: pctOfLine >= thresholdPct && recv > 0 && recv < line, pctOfLine, thresholdPct };
}

export type CarryForwardPlan = {
  ok: true;
  fromNo: number;
  toNo: number;
  allocated: number;
  carriedOut: number;
  carriedIn: number;
  nextAmountDue: number;
  nextBaseAmount: number;
  scheduleAfter: InstallmentItem[];
  feeAfter: ReturnType<typeof enrollmentFeeStateFromEnrollment>;
} | { ok: false; error: string };

/**
 * Build schedule after accepting a partial on `fromNo` and carrying shortfall to next open installment.
 * Does not mutate Inst2 `amount` — only sets carried_in / carried_out.
 */
export function planCarryForward(input: {
  enrollment: Pick<CourseEnrollment, "id" | "total_fee" | "schedule" | "discount_amount" | "amount_paid">;
  fromNo: number;
  /** Amount allocated to the partial line (usually paid_amount). */
  allocated?: number;
}): CarryForwardPlan {
  const schedule = (input.enrollment.schedule || []).map((l) => ({ ...l }));
  const fromIdx = schedule.findIndex((l) => l.no === input.fromNo);
  if (fromIdx < 0) return { ok: false, error: `Line ${input.fromNo} not found` };
  const from = schedule[fromIdx]!;
  const allocated =
    input.allocated != null
      ? Math.max(0, Math.round(input.allocated))
      : lineAllocatedAmount(from);
  if (allocated <= 0) return { ok: false, error: "Nothing allocated on source line" };

  const base = Math.max(0, Math.round(Number(from.amount) || 0));
  const shortfall = Math.max(0, base - allocated);
  if (shortfall <= 0) {
    return { ok: false, error: "No shortfall to carry — line is fully covered" };
  }

  // Next sequencing-open installment after from (skip seats/legacy paid/waived).
  const toIdx = schedule.findIndex((l, i) => {
    if (i <= fromIdx) return false;
    if (l.kind !== "installment") return false;
    if (l.paid || l.status === "waived" || l.status === "cancelled") return false;
    if (/legacy|pre-portal/i.test(l.label || "")) return false;
    return lineRemainingAmount(l) > 0 || (!l.paid && (l.status === "pending" || !l.status));
  });
  if (toIdx < 0) return { ok: false, error: "No later installment to carry into" };
  const to = schedule[toIdx]!;

  const fromUpdated: InstallmentItem = {
    ...from,
    paid: false,
    status: "partially_paid" as InstallmentLineStatus,
    paid_amount: allocated,
    carried_out: shortfall,
    cancelled_reason: from.status === "cancelled" ? null : from.cancelled_reason,
    updated_at: new Date().toISOString(),
  };
  const toUpdated: InstallmentItem = {
    ...to,
    // NEVER overwrite base amount
    amount: to.amount,
    carried_in: Math.max(0, Math.round(Number(to.carried_in) || 0)) + shortfall,
    updated_at: new Date().toISOString(),
  };
  schedule[fromIdx] = fromUpdated;
  schedule[toIdx] = toUpdated;

  const feeAfter = enrollmentFeeStateFromEnrollment({
    ...input.enrollment,
    schedule,
  });
  const nextState = feeAfter.instalments.find((l) => l.no === to.no);

  return {
    ok: true,
    fromNo: from.no,
    toNo: to.no,
    allocated,
    carriedOut: shortfall,
    carriedIn: shortfall,
    nextBaseAmount: Math.round(Number(to.amount) || 0),
    nextAmountDue: nextState?.remaining ?? Math.round(Number(to.amount) || 0) + shortfall,
    scheduleAfter: schedule,
    feeAfter,
  };
}

/** Idempotent: if carry already applied for this shortfall, return current plan as no-op success. */
export function planCarryForwardIdempotent(input: {
  enrollment: Pick<CourseEnrollment, "id" | "total_fee" | "schedule" | "discount_amount" | "amount_paid">;
  fromNo: number;
  allocated?: number;
}): CarryForwardPlan & { alreadyApplied?: boolean } {
  const schedule = input.enrollment.schedule || [];
  const from = schedule.find((l) => l.no === input.fromNo);
  if (from && Math.round(Number(from.carried_out) || 0) > 0 && from.status === "partially_paid") {
    const feeAfter = enrollmentFeeStateFromEnrollment(input.enrollment);
    const to = schedule.find(
      (l) => l.no !== from.no && Math.round(Number(l.carried_in) || 0) > 0 && l.kind === "installment",
    );
    return {
      ok: true,
      alreadyApplied: true,
      fromNo: from.no,
      toNo: to?.no ?? -1,
      allocated: lineAllocatedAmount(from),
      carriedOut: Math.round(Number(from.carried_out) || 0),
      carriedIn: Math.round(Number(to?.carried_in) || 0),
      nextBaseAmount: Math.round(Number(to?.amount) || 0),
      nextAmountDue:
        feeAfter.nextDueInstalment?.amountDue ??
        Math.round(Number(to?.amount) || 0) + Math.round(Number(to?.carried_in) || 0),
      scheduleAfter: schedule.map((l) => ({ ...l })),
      feeAfter,
    };
  }
  return planCarryForward(input);
}

/** Reverse a prior carry-forward (fixture / admin undo). Restores prior line shapes. */
export function reverseCarryForward(input: {
  enrollment: Pick<CourseEnrollment, "id" | "total_fee" | "schedule" | "discount_amount" | "amount_paid">;
  fromNo: number;
}): CarryForwardPlan {
  const schedule = (input.enrollment.schedule || []).map((l) => ({ ...l }));
  const fromIdx = schedule.findIndex((l) => l.no === input.fromNo);
  if (fromIdx < 0) return { ok: false, error: `Line ${input.fromNo} not found` };
  const from = schedule[fromIdx]!;
  const carriedOut = Math.round(Number(from.carried_out) || 0);
  if (carriedOut <= 0) return { ok: false, error: "No carried_out to reverse" };

  const toIdx = schedule.findIndex(
    (l, i) => i > fromIdx && Math.round(Number(l.carried_in) || 0) >= carriedOut,
  );
  if (toIdx < 0) return { ok: false, error: "No matching carried_in line to reverse" };
  const to = schedule[toIdx]!;

  schedule[fromIdx] = {
    ...from,
    carried_out: 0,
    status: "partially_paid" as InstallmentLineStatus,
    updated_at: new Date().toISOString(),
  };
  schedule[toIdx] = {
    ...to,
    carried_in: Math.max(0, Math.round(Number(to.carried_in) || 0) - carriedOut),
    amount: to.amount, // untouched
    updated_at: new Date().toISOString(),
  };

  const feeAfter = enrollmentFeeStateFromEnrollment({ ...input.enrollment, schedule });
  return {
    ok: true,
    fromNo: from.no,
    toNo: to.no,
    allocated: lineAllocatedAmount(from),
    carriedOut: 0,
    carriedIn: Math.round(Number(schedule[toIdx]!.carried_in) || 0),
    nextBaseAmount: Math.round(Number(to.amount) || 0),
    nextAmountDue: feeAfter.nextDueInstalment?.amountDue ?? Math.round(Number(to.amount) || 0),
    scheduleAfter: schedule,
    feeAfter,
  };
}
