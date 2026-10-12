/**
 * Pure schedule allocation for one PAID course payment.
 *
 * Used by unit tests and the demo-mode finalize path. Production uses the
 * matching SQL in finalize_course_payment() so allocation is locked in-DB.
 *
 * Demo-mode / in-process locks are NOT proof of multi-connection Postgres safety.
 *
 * Invariants:
 *  - Never marks more rupees than payment.amount (waterfall for full).
 *  - Seat / installment / full kinds preserved.
 *  - Partial student_proof installments leave paid=false with paid_amount.
 *  - Allocation eligibility includes partially_paid remainders (distinct from
 *    UI Pay-now sequencing which excludes them via isFeeLineOutstanding).
 */
import type { InstallmentItem, InstallmentKind } from "../types";
import { compareOutstandingOldestFirst } from "../installmentAllocation";
import { isLineCancelledOrWaived } from "../installments";
import { lineAllocatedAmount, lineRemainingAmount, isLinePartiallyPaid } from "../enrollmentFeeState";

export type AllocatePaymentInput = {
  amount: number;
  payment_kind: InstallmentKind | "full" | "one_time" | null | undefined;
  installment_no?: number | null;
  payment_source?: string | null;
  payment_id: string;
  reference_no: string;
  gateway_ref?: string | null;
  paid_at?: string | null;
};

export type AllocatePaymentResult = {
  schedule: InstallmentItem[];
  paymentLabel: string;
  allocatedAmount: number;
  linesTouched: { no: number; kind: string; amount: number }[];
  /** True when the payment could not be applied to any open line. */
  noop: boolean;
};

/** Lines that can still absorb money (includes partially_paid remainders). */
export function isLineAllocatable(
  line: Pick<InstallmentItem, "paid" | "status" | "amount" | "paid_amount" | "carried_in" | "carried_out">,
): boolean {
  if (line.paid || line.status === "paid" || line.status === "waived") return false;
  if (line.status === "cancelled" && lineAllocatedAmount(line) <= 0) return false;
  return lineRemainingAmount(line) > 0;
}

function markPaid(
  line: InstallmentItem,
  input: AllocatePaymentInput,
  paidAt: string,
): InstallmentItem {
  return {
    ...line,
    paid: true,
    paid_at: paidAt,
    reference_no: input.reference_no,
    gateway_ref: input.gateway_ref ?? null,
    payment_id: input.payment_id,
    paid_amount: line.amount,
    status: "paid",
  };
}

function scheduleNetAllocated(schedule: InstallmentItem[]): number {
  let n = 0;
  for (const line of schedule) {
    if (line.status === "waived") continue;
    if (line.status === "cancelled" && lineAllocatedAmount(line) <= 0) continue;
    n += lineAllocatedAmount(line);
  }
  return n;
}

function findOldestAllocatableIndex(schedule: InstallmentItem[], kind: InstallmentKind): number {
  let best = -1;
  for (let i = 0; i < schedule.length; i++) {
    const s = schedule[i]!;
    if (s.kind !== kind) continue;
    if (!isLineAllocatable(s)) continue;
    if (best < 0 || compareOutstandingOldestFirst(s, schedule[best]!) < 0) best = i;
  }
  return best;
}

/**
 * Apply one payment onto a copy of the schedule. Does not invent money:
 * allocatedAmount is always ≤ payment.amount.
 */
export function allocatePaymentToSchedule(
  scheduleIn: InstallmentItem[],
  input: AllocatePaymentInput,
): AllocatePaymentResult {
  const paidAt = input.paid_at || new Date().toISOString();
  const budget = Math.max(0, Math.round(Number(input.amount) || 0));
  const kind = (input.payment_kind || "full") as InstallmentKind | "full" | "one_time";
  const schedule = scheduleIn.map((s) => ({ ...s }));
  const linesTouched: { no: number; kind: string; amount: number }[] = [];
  let allocatedAmount = 0;
  let paymentLabel = "Payment";

  if (kind === "one_time" || budget <= 0) {
    return { schedule, paymentLabel, allocatedAmount: 0, linesTouched, noop: true };
  }

  const beforeNet = scheduleNetAllocated(schedule);

  if (kind === "seat") {
    let idx = schedule.findIndex(
      (s) => s.no === (input.installment_no ?? 0) && s.kind === "seat" && isLineAllocatable(s),
    );
    if (idx < 0) idx = schedule.findIndex((s) => s.kind === "seat" && isLineAllocatable(s));
    if (idx < 0) return { schedule, paymentLabel, allocatedAmount: 0, linesTouched, noop: true };
    const line = schedule[idx]!;
    const need = lineRemainingAmount(line);
    if (need <= 0) return { schedule, paymentLabel, allocatedAmount: 0, linesTouched, noop: true };
    if (budget < need && input.payment_source === "student_proof") {
      const add = budget;
      schedule[idx] = {
        ...line,
        paid: false,
        status: "partially_paid",
        paid_amount: Math.round(Number(line.paid_amount) || 0) + add,
        reference_no: input.reference_no,
        gateway_ref: input.gateway_ref ?? null,
        payment_id: input.payment_id,
      };
      allocatedAmount = add;
      paymentLabel = `${line.label} (partial)`;
      linesTouched.push({ no: line.no, kind: line.kind, amount: add });
    } else {
      if (budget < need) {
        return { schedule, paymentLabel, allocatedAmount: 0, linesTouched, noop: true };
      }
      schedule[idx] = markPaid(line, input, paidAt);
      allocatedAmount = need;
      paymentLabel = line.label;
      linesTouched.push({ no: line.no, kind: line.kind, amount: need });
    }
  } else if (kind === "installment") {
    const idx = findOldestAllocatableIndex(schedule, "installment");
    if (idx < 0) return { schedule, paymentLabel, allocatedAmount: 0, linesTouched, noop: true };
    const line = schedule[idx]!;
    const need = lineRemainingAmount(line);
    const prevPartial = Math.round(Number(line.paid_amount) || 0);
    const target = (line.amount || 0) + (Number(line.carried_in) || 0);
    const isProofPartial =
      input.payment_source === "student_proof" && budget > 0 && prevPartial + budget < target;
    if (isProofPartial) {
      schedule[idx] = {
        ...line,
        paid: false,
        status: "partially_paid",
        paid_amount: prevPartial + budget,
        reference_no: input.reference_no,
        gateway_ref: input.gateway_ref ?? null,
        payment_id: input.payment_id,
      };
      allocatedAmount = budget;
      paymentLabel = `${line.label} (partial)`;
      linesTouched.push({ no: line.no, kind: line.kind, amount: budget });
    } else {
      if (budget < need) {
        return { schedule, paymentLabel, allocatedAmount: 0, linesTouched, noop: true };
      }
      schedule[idx] = markPaid(line, input, paidAt);
      allocatedAmount = need;
      paymentLabel = line.label;
      linesTouched.push({ no: line.no, kind: line.kind, amount: need });
    }
  } else {
    let left = budget;
    const openIdx: number[] = [];
    for (let i = 0; i < schedule.length; i++) {
      if (isLineAllocatable(schedule[i]!)) openIdx.push(i);
    }
    openIdx.sort((a, b) => compareOutstandingOldestFirst(schedule[a]!, schedule[b]!));
    for (const idx of openIdx) {
      if (left <= 0) break;
      const line = schedule[idx]!;
      const need = lineRemainingAmount(line);
      if (need <= 0) continue;
      if (left >= need) {
        schedule[idx] = markPaid(line, input, paidAt);
        left -= need;
        allocatedAmount += need;
        linesTouched.push({ no: line.no, kind: line.kind, amount: need });
      } else {
        schedule[idx] = {
          ...line,
          paid: false,
          status: "partially_paid",
          paid_amount: Math.round(Number(line.paid_amount) || 0) + left,
          reference_no: input.reference_no,
          gateway_ref: input.gateway_ref ?? null,
          payment_id: input.payment_id,
        };
        allocatedAmount += left;
        linesTouched.push({ no: line.no, kind: line.kind, amount: left });
        left = 0;
      }
    }
    paymentLabel = "Full Remaining Payment";
    if (schedule.every((s) => s.kind === "full" || s.paid || isLineCancelledOrWaived(s))) {
      paymentLabel = "Full Payment";
    }
  }

  const afterNet = scheduleNetAllocated(schedule);
  if (afterNet - beforeNet !== allocatedAmount) {
    allocatedAmount = Math.max(0, afterNet - beforeNet);
  }
  if (allocatedAmount > budget) {
    return {
      schedule: scheduleIn.map((s) => ({ ...s })),
      paymentLabel: "Payment",
      allocatedAmount: 0,
      linesTouched: [],
      noop: true,
    };
  }

  return {
    schedule,
    paymentLabel,
    allocatedAmount,
    linesTouched,
    noop: linesTouched.length === 0,
  };
}

function evidenceMatch<T extends {
  payment_label?: string | null;
  payment_kind?: string | null;
}>(
  row: T,
  opts: { paymentKind?: string | null; installmentNo?: number | null },
): boolean {
  const kind = (opts.paymentKind || "").toLowerCase();
  const label = row.payment_label || "";
  if (kind === "seat") {
    return row.payment_kind === "seat" || /seat/i.test(label);
  }
  if (kind === "installment" && opts.installmentNo != null) {
    const re = new RegExp(`installment\\s*${opts.installmentNo}\\b`, "i");
    return re.test(label);
  }
  if (kind === "full") {
    return row.payment_kind === "full" || /full/i.test(label);
  }
  return false;
}

/**
 * Evidence-based canonical receipt among duplicates.
 * Does NOT treat payment.receipt_no as authoritative when it conflicts with
 * payment_kind / installment evidence (phantom race receipts).
 * Returns null when ambiguous and review is required.
 */
export function pickCanonicalReceipt<T extends {
  id: string;
  receipt_no: string;
  payment_id?: string | null;
  payment_label?: string | null;
  payment_kind?: string | null;
  issued_at?: string | null;
  superseded_at?: string | null;
  paid_to_date?: number | null;
}>(
  rows: T[],
  opts: {
    paymentReceiptNo?: string | null;
    paymentKind?: string | null;
    installmentNo?: number | null;
    /** When true, return null instead of a weak fallback if evidence is ambiguous. */
    requireEvidence?: boolean;
  },
): T | null {
  if (!rows.length) return null;
  const active = rows.filter((r) => !r.superseded_at);
  const pool = active.length ? active : rows;
  const evidence = pool.filter((r) => evidenceMatch(r, opts));
  const sortedEvidence = [...evidence].sort((a, b) =>
    String(a.issued_at || "").localeCompare(String(b.issued_at || "")),
  );

  if (sortedEvidence.length === 1) return sortedEvidence[0]!;
  if (sortedEvidence.length > 1) {
    // Distinct labels among evidence → ambiguous.
    const labels = new Set(sortedEvidence.map((r) => (r.payment_label || "").toLowerCase()));
    if (labels.size > 1 && opts.requireEvidence) return null;
    return sortedEvidence[0]!;
  }

  // No evidence match. If pointer exists and is the only row, use it; else ambiguous.
  if (opts.paymentReceiptNo) {
    const pointed = pool.find((r) => r.receipt_no === opts.paymentReceiptNo);
    if (pointed && pool.length === 1) return pointed;
    if (opts.requireEvidence && pool.length > 1) return null;
    if (pointed && !evidenceMatch(pointed, opts) && pool.length > 1) return null;
  }

  if (opts.requireEvidence && pool.length > 1) {
    const labels = new Set(pool.map((r) => (r.payment_label || "").toLowerCase()));
    if (labels.size > 1) return null;
  }

  return [...pool].sort((a, b) => String(a.issued_at || "").localeCompare(String(b.issued_at || "")))[0] || null;
}

export { isLinePartiallyPaid };
