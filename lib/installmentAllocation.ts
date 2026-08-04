/**
 * Oldest-outstanding-first instalment allocation.
 *
 * A payment clears the earliest unpaid schedule line (by due date, then `no`),
 * not the installment the checkout stamped on the payment row. Standard
 * receivables practice — never invents money or changes line amounts/dues.
 */
import type { InstallmentItem, InstallmentKind } from "./types";
import { isLineCancelledOrWaived, isLineOutstanding } from "./installments";

function dueMs(due: string | null | undefined): number {
  if (!due) return Number.NEGATIVE_INFINITY; // null due = already "due" (legacy / seat)
  const t = Date.parse(due);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/** Compare two outstanding lines: earlier due first, then lower `no`. */
export function compareOutstandingOldestFirst(a: InstallmentItem, b: InstallmentItem): number {
  const d = dueMs(a.due) - dueMs(b.due);
  if (d !== 0) return d;
  return (a.no || 0) - (b.no || 0);
}

/**
 * Index of the oldest unpaid line for `kind` (seat / installment).
 * Returns -1 when none outstanding.
 */
export function findOldestOutstandingIndex(
  schedule: InstallmentItem[],
  kind: InstallmentKind | "full",
): number {
  if (kind === "full") return -1;
  let best = -1;
  for (let i = 0; i < schedule.length; i++) {
    const s = schedule[i];
    if (s.kind !== kind) continue;
    if (!isLineOutstanding(s)) continue;
    if (best < 0 || compareOutstandingOldestFirst(s, schedule[best]) < 0) best = i;
  }
  return best;
}

export type PaidScheduleEvent = {
  amount: number;
  paid_at: string | null;
  reference_no: string | null;
  gateway_ref: string | null;
  payment_id: string | null;
  paid_amount: number | null;
  receipt_no: string | null;
  /** Original schedule `no` before reallocation (audit). */
  from_no: number;
};

export type AllocationLineSnapshot = {
  no: number;
  kind: string;
  amount: number;
  due: string | null;
  paid: boolean;
  reference_no: string | null;
  paid_at: string | null;
};

export type ReallocateResult = {
  schedule: InstallmentItem[];
  changed: boolean;
  before: AllocationLineSnapshot[];
  after: AllocationLineSnapshot[];
  paidSumBefore: number;
  paidSumAfter: number;
  events: PaidScheduleEvent[];
};

function snapshot(schedule: InstallmentItem[]): AllocationLineSnapshot[] {
  return schedule.map((s) => ({
    no: s.no,
    kind: s.kind,
    amount: s.amount,
    due: s.due,
    paid: !!s.paid,
    reference_no: s.reference_no ?? null,
    paid_at: s.paid_at ?? null,
  }));
}

function paidSum(schedule: InstallmentItem[]): number {
  return schedule.filter((s) => s.paid && !isLineCancelledOrWaived(s)).reduce((a, s) => a + (s.amount || 0), 0);
}

/**
 * Re-label paid flags onto oldest-outstanding lines. Preserves every paid event
 * (reference / paid_at / gateway) — only moves which line they sit on.
 * Seat lines are left untouched. Amounts and dues never change.
 */
export function reallocateScheduleOldestFirst(schedule: InstallmentItem[]): ReallocateResult {
  const before = snapshot(schedule);
  const paidSumBefore = paidSum(schedule);

  const events: PaidScheduleEvent[] = [];
  for (const s of schedule) {
    // Only reshuffle installment lines. Seat + full-payment lines stay put.
    if (s.kind !== "installment") continue;
    if (isLineCancelledOrWaived(s)) continue;
    if (!s.paid) continue;
    events.push({
      amount: s.amount || 0,
      paid_at: s.paid_at ?? null,
      reference_no: s.reference_no ?? null,
      gateway_ref: s.gateway_ref ?? null,
      payment_id: s.payment_id ?? null,
      paid_amount: s.paid_amount ?? null,
      receipt_no: s.receipt_no ?? null,
      from_no: s.no,
    });
  }
  events.sort((a, b) => {
    const ta = a.paid_at ? Date.parse(a.paid_at) : 0;
    const tb = b.paid_at ? Date.parse(b.paid_at) : 0;
    if (ta !== tb) return ta - tb;
    return a.from_no - b.from_no;
  });

  // Nothing to reshuffle (full-only / seat-only / no paid installments).
  if (events.length === 0) {
    return {
      schedule: schedule.map((s) => ({ ...s })),
      changed: false,
      before,
      after: before,
      paidSumBefore,
      paidSumAfter: paidSumBefore,
      events,
    };
  }

  const next: InstallmentItem[] = schedule.map((s) => {
    if (s.kind !== "installment" || isLineCancelledOrWaived(s)) return { ...s };
    return {
      ...s,
      paid: false,
      paid_at: null,
      reference_no: null,
      gateway_ref: null,
      payment_id: null,
      paid_amount: null,
      receipt_no: null,
      status: s.status === "paid" ? "pending" : s.status,
    };
  });

  let ei = 0;
  while (ei < events.length) {
    const idx = findOldestOutstandingIndex(next, "installment");
    if (idx < 0) break;
    const ev = events[ei++];
    const line = next[idx];
    next[idx] = {
      ...line,
      paid: true,
      paid_at: ev.paid_at,
      reference_no: ev.reference_no,
      gateway_ref: ev.gateway_ref,
      payment_id: ev.payment_id,
      paid_amount: ev.paid_amount ?? line.amount,
      receipt_no: ev.receipt_no,
      status: "paid",
    };
  }

  // If events remain (more paid events than installment lines), put them back on
  // the last installment line — should not happen for healthy schedules.
  if (ei < events.length) {
    for (let i = next.length - 1; i >= 0 && ei < events.length; i--) {
      if (next[i].kind !== "installment" || isLineCancelledOrWaived(next[i])) continue;
      if (next[i].paid) continue;
      const ev = events[ei++];
      next[i] = {
        ...next[i],
        paid: true,
        paid_at: ev.paid_at,
        reference_no: ev.reference_no,
        gateway_ref: ev.gateway_ref,
        payment_id: ev.payment_id,
        paid_amount: ev.paid_amount ?? next[i].amount,
        receipt_no: ev.receipt_no,
        status: "paid",
      };
    }
  }

  const paidSumAfter = paidSum(next);
  const after = snapshot(next);
  // Only report changed when paid flags / refs on installment lines actually moved.
  const instBefore = before.filter((b) => b.kind === "installment");
  const instAfter = after.filter((a) => a.kind === "installment");
  const changed = JSON.stringify(instBefore) !== JSON.stringify(instAfter);

  return { schedule: next, changed, before, after, paidSumBefore, paidSumAfter, events };
}

/** Assert reallocation did not move a single rupee of paid total. */
export function assertAllocationTotalsUnchanged(
  beforePaidSum: number,
  afterPaidSum: number,
  amountPaidBefore: number,
  amountPaidAfter: number,
): { ok: true } | { ok: false; error: string } {
  if (Math.round(beforePaidSum) !== Math.round(afterPaidSum)) {
    return { ok: false, error: `paid-sum moved: ${beforePaidSum} → ${afterPaidSum}` };
  }
  if (Math.round(amountPaidBefore) !== Math.round(amountPaidAfter)) {
    return { ok: false, error: `amount_paid moved: ${amountPaidBefore} → ${amountPaidAfter}` };
  }
  return { ok: true };
}
