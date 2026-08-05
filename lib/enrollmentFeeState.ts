/**
 * ONE source of truth for enrollment fee / instalment read state.
 *
 * Do NOT ad-hoc sum schedule.paid / amount_paid / total_fee − amount_paid elsewhere.
 * Call getEnrollmentFeeState(enrollmentId) or enrollmentFeeStateFromEnrollment(enr).
 *
 * Schedule JSON is the plan. Money on a line is: full `amount` when paid=true,
 * else `paid_amount` when present — INCLUDING cancelled lines that still carry
 * money (partial proof approval that left status=cancelled). True cancels
 * (cancelled + no money) are excluded.
 *
 * Carry-forward: `carried_in` / `carried_out` are adjustment rows on the line —
 * never mutate the next installment's base `amount`. remaining =
 * max(0, original + carriedIn − allocated − carriedOut).
 */
import type { CourseEnrollment, InstallmentItem, InstallmentLineStatus } from "./types";

export type FeeLineStatus =
  | "paid"
  | "partially_paid"
  | "pending"
  | "overdue"
  | "due_soon"
  | "upcoming"
  | "waived"
  | "cancelled";

export interface EnrollmentFeeLineState {
  no: number;
  kind: InstallmentItem["kind"];
  label: string;
  /** Original plan amount (never mutated by carry). */
  original: number;
  allocated: number;
  carriedIn: number;
  carriedOut: number;
  remaining: number;
  status: FeeLineStatus;
  dueDate: string | null;
  /** True cancel with no money — hidden from student schedule. */
  hidden: boolean;
  paymentId: string | null;
}

export interface EnrollmentFeeNextDue {
  n: number;
  label: string;
  baseAmount: number;
  carriedIn: number;
  amountDue: number;
  dueDate: string | null;
  kind: InstallmentItem["kind"];
}

export interface EnrollmentFeeState {
  enrollmentId: string;
  totalFee: number;
  discount: number;
  legacyPaid: number;
  netPaid: number;
  outstanding: number;
  progressPct: number;
  nextDueInstalment: EnrollmentFeeNextDue | null;
  payFullRemainingAmount: number;
  instalments: EnrollmentFeeLineState[];
  /** Convenience: schedule-shaped next payable for legacy callers. */
  nextPayableItem: InstallmentItem | null;
  paidCount: number;
  installmentTotal: number;
  seatPaid: boolean;
  seatPaidAmount: number;
  isFullyPaid: boolean;
  hasOverdue: boolean;
}

function lineCarriedIn(line: Pick<InstallmentItem, "carried_in">): number {
  return Math.max(0, Math.round(Number(line.carried_in) || 0));
}

function lineCarriedOut(line: Pick<InstallmentItem, "carried_out">): number {
  return Math.max(0, Math.round(Number(line.carried_out) || 0));
}

/** Money already applied to a schedule line (full or partial). */
export function lineAllocatedAmount(line: Pick<InstallmentItem, "paid" | "amount" | "paid_amount" | "status">): number {
  if (line.status === "waived") return 0;
  if (line.paid) return Math.max(0, Number(line.amount) || 0);
  return Math.max(0, Number(line.paid_amount) || 0);
}

/** True cancel: cancelled with no money applied. */
export function isTrueCancelledLine(line: Pick<InstallmentItem, "status" | "paid" | "paid_amount" | "amount">): boolean {
  if (line.status !== "cancelled") return false;
  return lineAllocatedAmount(line) <= 0;
}

export function lineRemainingAmount(
  line: Pick<InstallmentItem, "paid" | "amount" | "paid_amount" | "status" | "carried_in" | "carried_out">,
): number {
  if (line.paid || line.status === "paid" || line.status === "waived") return 0;
  if (isTrueCancelledLine(line)) return 0;
  const original = Math.max(0, Number(line.amount) || 0);
  const allocated = lineAllocatedAmount(line);
  return Math.max(0, original + lineCarriedIn(line) - allocated - lineCarriedOut(line));
}

/**
 * Partial settlement: money received but line not fully closed as paid=true.
 * Heals cancelled-with-money into partially_paid for READS. After carry-out
 * closes remaining, status stays partially_paid with remaining 0.
 */
export function isLinePartiallyPaid(
  line: Pick<InstallmentItem, "paid" | "amount" | "paid_amount" | "status" | "carried_in" | "carried_out">,
): boolean {
  if (line.paid) return false;
  if (line.status === "waived") return false;
  if (line.status === "partially_paid") return true;
  const allocated = lineAllocatedAmount(line);
  if (allocated <= 0) return false;
  const original = Math.max(0, Number(line.amount) || 0);
  const target = original + lineCarriedIn(line);
  if (allocated < target) return true;
  // Allocated covers base but carried_out closed the rest without paid=true.
  return lineCarriedOut(line) > 0;
}

/**
 * Still chasing this line for next-pay / overdue sequencing.
 * partially_paid (even with residual before carry) is not the Pay-now target;
 * after carry-out remaining is 0 and the next open line is chased.
 */
export function isFeeLineOutstanding(
  line: Pick<InstallmentItem, "paid" | "status" | "amount" | "paid_amount" | "carried_in" | "carried_out">,
): boolean {
  if (line.paid || line.status === "waived") return false;
  if (isTrueCancelledLine(line)) return false;
  if (line.status === "cancelled" && lineAllocatedAmount(line) <= 0) return false;
  if (isLinePartiallyPaid(line)) return false;
  return lineRemainingAmount(line) > 0;
}

/** Alias — next-pay / ladder / AAR use the same open-line rule. */
export function isFeeLineSequencingOpen(
  line: Pick<InstallmentItem, "paid" | "status" | "amount" | "paid_amount" | "carried_in" | "carried_out">,
): boolean {
  return isFeeLineOutstanding(line);
}

function resolveLineStatus(line: InstallmentItem, now: number): FeeLineStatus {
  if (line.paid || line.status === "paid") return "paid";
  if (line.status === "waived") return "waived";
  if (isLinePartiallyPaid(line)) return "partially_paid";
  if (isTrueCancelledLine(line) || line.status === "cancelled") return "cancelled";
  if (line.due == null) return "due_soon";
  const t = new Date(line.due).getTime();
  if (t < now) return "overdue";
  if (t - now < 3 * 86_400_000) return "due_soon";
  return "upcoming";
}

function isLegacyLine(line: InstallmentItem): boolean {
  if (line.kind === "seat") return true;
  const label = String(line.label || "").toLowerCase();
  return /legacy|pre-portal|seat/.test(label) && line.paid;
}

/**
 * Pure read model from an enrollment row. Never writes.
 * Ignores denormalized `amount_paid` — schedule money fields are authoritative here.
 */
export function enrollmentFeeStateFromEnrollment(
  enr: Pick<
    CourseEnrollment,
    "id" | "total_fee" | "schedule" | "discount_amount" | "amount_paid"
  >,
  now = Date.now(),
): EnrollmentFeeState {
  const schedule = enr.schedule || [];
  const totalFee = Math.max(0, Number(enr.total_fee) || 0);
  const discount = Math.max(0, Number(enr.discount_amount) || 0);

  const instalments: EnrollmentFeeLineState[] = schedule.map((line) => {
    const original = Math.max(0, Number(line.amount) || 0);
    const allocated = lineAllocatedAmount(line);
    const carriedIn = lineCarriedIn(line);
    const carriedOut = lineCarriedOut(line);
    const status = resolveLineStatus(line, now);
    const hidden = status === "cancelled" && allocated <= 0;
    const remaining =
      status === "paid" || status === "waived" || hidden
        ? 0
        : Math.max(0, original + carriedIn - allocated - carriedOut);
    return {
      no: line.no,
      kind: line.kind,
      label: line.label,
      original,
      allocated,
      carriedIn,
      carriedOut,
      remaining,
      status,
      dueDate: line.due,
      hidden,
      paymentId: line.payment_id ?? null,
    };
  });

  let netPaid = 0;
  let legacyPaid = 0;
  for (let i = 0; i < schedule.length; i++) {
    const line = schedule[i]!;
    const st = instalments[i]!;
    if (st.hidden || st.status === "waived") continue;
    netPaid += st.allocated;
    if (isLegacyLine(line) || line.kind === "seat") legacyPaid += st.allocated;
  }

  // Guard: never exceed fee; never negative outstanding.
  netPaid = Math.min(netPaid, totalFee);
  const outstanding = Math.max(0, totalFee - netPaid);
  const progressPct = totalFee > 0 ? Math.round((netPaid / totalFee) * 100) : 0;

  const visibleInstallments = instalments.filter(
    (l) => l.kind === "installment" && !l.hidden && l.status !== "waived",
  );
  const planInstallments = visibleInstallments.filter((l) => !/legacy|pre-portal/i.test(l.label));
  const paidCount = planInstallments.filter((l) => l.status === "paid").length;
  const installmentTotal = planInstallments.length;

  const seatLines = instalments.filter((l) => l.kind === "seat" && l.status === "paid");
  const seatPaidAmount = seatLines.reduce((a, l) => a + l.allocated, 0);

  const nextIdx = schedule.findIndex((line) => isFeeLineSequencingOpen(line));
  const nextLine = nextIdx >= 0 ? schedule[nextIdx]! : null;
  const nextState = nextIdx >= 0 ? instalments[nextIdx]! : null;

  const nextDueInstalment: EnrollmentFeeNextDue | null =
    nextLine && nextState
      ? {
          n: nextLine.no,
          label: nextLine.label,
          baseAmount: nextState.original,
          carriedIn: nextState.carriedIn,
          amountDue: nextState.remaining > 0 ? nextState.remaining : nextState.original + nextState.carriedIn,
          dueDate: nextLine.due,
          kind: nextLine.kind,
        }
      : null;

  const nextPayableItem: InstallmentItem | null = nextLine
    ? {
        ...nextLine,
        amount: nextDueInstalment?.amountDue ?? nextLine.amount,
        status: (nextState?.status === "partially_paid"
          ? "partially_paid"
          : nextLine.status) as InstallmentLineStatus,
      }
    : null;

  const hasOverdue = instalments.some(
    (l) => l.status === "overdue" && !l.hidden && l.remaining > 0,
  );

  return {
    enrollmentId: enr.id,
    totalFee,
    discount,
    legacyPaid,
    netPaid,
    outstanding,
    progressPct,
    nextDueInstalment,
    payFullRemainingAmount: outstanding,
    instalments,
    nextPayableItem,
    paidCount,
    installmentTotal,
    seatPaid: seatPaidAmount > 0,
    seatPaidAmount,
    isFullyPaid: outstanding <= 0,
    hasOverdue,
  };
}

/** Reject gateway/order amounts that exceed outstanding (server-side only). */
export function assertOrderAmountWithinOutstanding(
  amount: number,
  outstanding: number,
): { ok: true } | { ok: false; error: string } {
  const a = Math.round(Number(amount) || 0);
  const o = Math.round(Number(outstanding) || 0);
  if (a <= 0) return { ok: false, error: "Nothing to pay." };
  if (a > o) {
    return {
      ok: false,
      error: `Amount ₹${a.toLocaleString("en-IN")} exceeds outstanding balance ₹${o.toLocaleString("en-IN")}.`,
    };
  }
  return { ok: true };
}
