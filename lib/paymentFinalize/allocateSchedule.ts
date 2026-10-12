/**
 * Pure schedule allocation for one PAID course payment.
 * Used by unit tests and the demo-mode finalize path. Production uses the
 * matching SQL in finalize_course_payment() so allocation is locked in-DB.
 *
 * Invariants:
 *  - Never marks more rupees than payment.amount (waterfall for full).
 *  - Seat / installment / full kinds preserved.
 *  - Partial student_proof installments leave paid=false with paid_amount.
 */
import type { InstallmentItem, InstallmentKind } from "../types";
import { compareOutstandingOldestFirst, findOldestOutstandingIndex } from "../installmentAllocation";
import { isLineCancelledOrWaived, isLineOutstanding } from "../installments";
import { lineAllocatedAmount, lineRemainingAmount } from "../enrollmentFeeState";

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
      (s) => s.no === (input.installment_no ?? 0) && s.kind === "seat" && isLineOutstanding(s),
    );
    if (idx < 0) idx = schedule.findIndex((s) => s.kind === "seat" && isLineOutstanding(s));
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
        paid_amount: (Math.round(Number(line.paid_amount) || 0) + add),
        reference_no: input.reference_no,
        gateway_ref: input.gateway_ref ?? null,
        payment_id: input.payment_id,
      };
      allocatedAmount = add;
      paymentLabel = `${line.label} (partial)`;
      linesTouched.push({ no: line.no, kind: line.kind, amount: add });
    } else {
      // Seat is all-or-nothing for gateway payments; require full line coverage.
      if (budget < need) {
        return { schedule, paymentLabel, allocatedAmount: 0, linesTouched, noop: true };
      }
      schedule[idx] = markPaid(line, input, paidAt);
      allocatedAmount = need;
      paymentLabel = line.label;
      linesTouched.push({ no: line.no, kind: line.kind, amount: need });
    }
  } else if (kind === "installment") {
    const idx = findOldestOutstandingIndex(schedule, "installment");
    if (idx < 0) return { schedule, paymentLabel, allocatedAmount: 0, linesTouched, noop: true };
    const line = schedule[idx]!;
    const need = lineRemainingAmount(line);
    const prevPartial = Math.round(Number(line.paid_amount) || 0);
    const isProofPartial =
      input.payment_source === "student_proof" && budget > 0 && prevPartial + budget < (line.amount || 0) + (Number(line.carried_in) || 0);
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
        // Not enough for a full clear and not a proof partial — refuse rather than
        // half-mark a gateway installment (prevents silent under-pay clearing).
        return { schedule, paymentLabel, allocatedAmount: 0, linesTouched, noop: true };
      }
      schedule[idx] = markPaid(line, input, paidAt);
      allocatedAmount = need;
      paymentLabel = line.label;
      linesTouched.push({ no: line.no, kind: line.kind, amount: need });
    }
  } else {
    // full — waterfall across outstanding lines (seat first by due/no, then installments).
    let left = budget;
    const openIdx: number[] = [];
    for (let i = 0; i < schedule.length; i++) {
      if (isLineOutstanding(schedule[i]!)) openIdx.push(i);
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
    // Defensive: never allow drift between touched sum and net change.
    allocatedAmount = Math.max(0, afterNet - beforeNet);
  }
  if (allocatedAmount > budget) {
    // Should be unreachable; fail closed by reverting.
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

/** Pick the canonical receipt among duplicates for one payment/reference. */
export function pickCanonicalReceipt<T extends {
  id: string;
  receipt_no: string;
  payment_id?: string | null;
  payment_label?: string | null;
  payment_kind?: string | null;
  issued_at?: string | null;
  superseded_at?: string | null;
}>(
  rows: T[],
  opts: { paymentReceiptNo?: string | null; paymentKind?: string | null; installmentNo?: number | null },
): T | null {
  const active = rows.filter((r) => !r.superseded_at);
  const pool = active.length ? active : rows;
  if (!pool.length) return null;
  if (opts.paymentReceiptNo) {
    const hit = pool.find((r) => r.receipt_no === opts.paymentReceiptNo);
    if (hit) return hit;
  }
  const kind = (opts.paymentKind || "").toLowerCase();
  if (kind === "seat") {
    const seat = pool.find((r) => /seat/i.test(r.payment_label || "") || r.payment_kind === "seat");
    if (seat) return seat;
  }
  if (kind === "installment" && opts.installmentNo != null) {
    const re = new RegExp(`installment\\s*${opts.installmentNo}\\b`, "i");
    const labeled = pool.find((r) => re.test(r.payment_label || ""));
    if (labeled) return labeled;
  }
  return [...pool].sort((a, b) => String(a.issued_at || "").localeCompare(String(b.issued_at || "")))[0] || null;
}
