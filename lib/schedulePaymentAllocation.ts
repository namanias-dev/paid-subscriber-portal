/**
 * One allocator for course schedule money.
 *
 * A payment is the rupees received. An allocation is how much of that payment
 * lands on each schedule line. A line is paid only when its remaining is 0.
 * The contractual `amount` is never rewritten.
 *
 * Installments fill the oldest line that still has a remainder, then spill
 * into the next. Seat lines stay exact-match. Kind `full` settles every open
 * line and is only chosen by the caller when the payment covers the balance.
 */
import type { InstallmentItem } from "./types";
import { isLineCancelledOrWaived } from "./installments";
import { findOldestOutstandingIndex } from "./installmentAllocation";
import { lineAllocatedAmount, lineRemainingAmount } from "./enrollmentFeeState";
import { formatINR } from "./dates";

export type SchedulePayment = {
  amount: number;
  payment_kind?: string | null;
  installment_no?: number | null;
  reference_no?: string | null;
  gateway_ref?: string | null;
  razorpay_payment_id?: string | null;
  id?: string | null;
  transaction_date?: string | null;
  created_at?: string | null;
};

export type AllocationResult = {
  schedule: InstallmentItem[];
  paymentLabel: string;
};

function stamp(
  line: InstallmentItem,
  payment: SchedulePayment,
  paidAt: string,
): Pick<InstallmentItem, "reference_no" | "gateway_ref" | "payment_id" | "paid_at"> {
  return {
    reference_no: payment.reference_no || null,
    gateway_ref: payment.gateway_ref || payment.razorpay_payment_id || null,
    payment_id: payment.id || line.payment_id || null,
    paid_at: paidAt,
  };
}

function closeLine(line: InstallmentItem, payment: SchedulePayment, paidAt: string): InstallmentItem {
  return {
    ...line,
    paid: true,
    status: "paid",
    paid_amount: Math.max(0, Math.round(Number(line.amount) || 0)),
    ...stamp(line, payment, paidAt),
  };
}

/**
 * Apply one captured payment onto a schedule copy.
 * Does not look at receipts — callers enforce one effect per reference.
 */
export function allocatePaymentOntoSchedule(
  schedule: InstallmentItem[],
  payment: SchedulePayment,
  opts?: { paidAt?: string; planType?: string | null },
): AllocationResult {
  const kind = (payment.payment_kind || "full") as "one_time" | "seat" | "installment" | "full";
  const paidAt = opts?.paidAt || payment.transaction_date || payment.created_at || new Date().toISOString();
  const next = schedule.map((s) => ({ ...s }));

  if (kind === "one_time") return { schedule: next, paymentLabel: "Payment" };

  if (kind === "full") {
    next.forEach((s, i) => {
      if (!s.paid && !isLineCancelledOrWaived(s)) next[i] = closeLine(s, payment, paidAt);
    });
    const paymentLabel = opts?.planType === "full" ? "Full Payment" : "Full Remaining Payment";
    return { schedule: next, paymentLabel };
  }

  if (kind === "seat") {
    const exact = next.findIndex(
      (s) => s.no === (payment.installment_no ?? 0) && s.kind === "seat" && !s.paid && !isLineCancelledOrWaived(s),
    );
    const idx = exact === -1
      ? next.findIndex((s) => s.kind === "seat" && !s.paid && !isLineCancelledOrWaived(s))
      : exact;
    if (idx >= 0) {
      next[idx] = closeLine(next[idx]!, payment, paidAt);
      return { schedule: next, paymentLabel: next[idx]!.label };
    }
    return { schedule: next, paymentLabel: "Book Your Seat" };
  }

  let left = Math.max(0, Math.round(Number(payment.amount) || 0));
  const labels: string[] = [];
  let guard = 0;
  while (left > 0 && guard++ < next.length + 1) {
    const idx = findOldestOutstandingIndex(next, "installment");
    if (idx < 0) break;
    const line = next[idx]!;
    const rem = lineRemainingAmount(line);
    if (rem <= 0) break;
    const apply = Math.min(left, rem);
    const cumulative = lineAllocatedAmount(line) + apply;
    if (apply >= rem) {
      next[idx] = closeLine(line, payment, paidAt);
      labels.push(line.label);
    } else {
      next[idx] = {
        ...line,
        paid: false,
        status: "partially_paid",
        paid_amount: cumulative,
        paid_at: null,
        reference_no: payment.reference_no || null,
        gateway_ref: payment.gateway_ref || payment.razorpay_payment_id || null,
        payment_id: payment.id || line.payment_id || null,
      };
      labels.push(`${line.label} (partial)`);
    }
    left -= apply;
  }

  return {
    schedule: next,
    paymentLabel: labels.length ? labels.join(" · ") : "Installment",
  };
}

/**
 * Replay captured payments in order. The same reference is applied once.
 */
export function replayPaymentsOntoSchedule(
  schedule: InstallmentItem[],
  payments: SchedulePayment[],
  opts?: { planType?: string | null },
): InstallmentItem[] {
  const seen = new Set<string>();
  let next = schedule.map((s) => ({ ...s }));
  for (const payment of payments) {
    const ref = (payment.reference_no || "").trim();
    if (ref && seen.has(ref)) continue;
    if (ref) seen.add(ref);
    next = allocatePaymentOntoSchedule(next, payment, opts).schedule;
  }
  return next;
}

export type OfflineKind = "seat" | "installment" | "full";

/**
 * Existing offline rule: never record more than the enrollment balance.
 * An installment override that covers the whole balance settles as `full`.
 * A smaller override stays an installment and is allocated oldest-first.
 */
export function capOfflineAmount(input: {
  kind: OfflineKind;
  amount: number;
  enrollmentRemaining: number;
  amountOverride?: number | null;
}): { ok: true; amount: number; kind: OfflineKind } | { ok: false; error: string } {
  const enrollmentRemaining = Math.round(Number(input.enrollmentRemaining) || 0);
  if (enrollmentRemaining <= 0) return { ok: false, error: "This enrollment is already fully paid." };
  let amount = Math.max(0, Math.round(Number(input.amount) || 0));
  let kind = input.kind;
  if (input.amountOverride != null && Number.isFinite(Number(input.amountOverride))) {
    const override = Math.round(Number(input.amountOverride));
    if (override <= 0) return { ok: false, error: "Amount must be greater than zero." };
    // A short seat payment must not mark the whole seat line received.
    if (kind === "seat" && override < Math.round(input.amount)) {
      return { ok: false, error: "A seat payment has to match the seat amount." };
    }
    amount = Math.min(override, enrollmentRemaining);
    if (override >= enrollmentRemaining && kind === "installment") kind = "full";
    // A full settlement is only a full settlement when the money covers the balance.
    if (kind === "full" && amount < enrollmentRemaining) kind = "installment";
  }
  return { ok: true, amount, kind };
}

export type AllocationNotice = {
  amount: number;
  kind: OfflineKind;
  capped: boolean;
  lines: { label: string; applied: number; obligation: number; paidToDate: number; remaining: number; fullyPaid: boolean }[];
};

/** Staff-facing preview of one offline payment. Amounts are rupees. */
export function previewOfflineAllocation(input: {
  schedule: InstallmentItem[];
  kind: OfflineKind;
  /** Remaining on the line staff picked. Ignored once an override is present. */
  lineRemaining: number | null;
  enrollmentRemaining: number;
  amountOverride?: number | null;
  planType?: string | null;
}): { ok: true; notice: AllocationNotice } | { ok: false; error: string } {
  const capped = capOfflineAmount({
    kind: input.kind,
    amount: input.kind === "full" ? input.enrollmentRemaining : Math.max(0, Math.round(input.lineRemaining || 0)),
    enrollmentRemaining: input.enrollmentRemaining,
    amountOverride: input.amountOverride,
  });
  if (!capped.ok) return capped;
  const before = input.schedule.map((s) => ({ ...s }));
  const after = allocatePaymentOntoSchedule(
    before,
    { amount: capped.amount, payment_kind: capped.kind },
    { planType: input.planType },
  ).schedule;
  const lines = after.flatMap((line, i) => {
    const prev = before[i]!;
    const prevPaid = lineAllocatedAmount(prev);
    const nextPaid = lineAllocatedAmount(line);
    const applied = nextPaid - prevPaid;
    if (applied <= 0 && prev.paid === line.paid) return [];
    const obligation = Math.max(0, Math.round(Number(line.amount) || 0));
    return [{
      label: line.label,
      applied,
      obligation,
      paidToDate: nextPaid,
      remaining: lineRemainingAmount(line),
      fullyPaid: !!line.paid,
    }];
  });
  const override = input.amountOverride != null ? Math.round(Number(input.amountOverride)) : capped.amount;
  return {
    ok: true,
    notice: {
      amount: capped.amount,
      kind: capped.kind,
      capped: override > input.enrollmentRemaining,
      lines,
    },
  };
}

/** Copy for the admin payment form. Empty when there is nothing partial to explain. */
export function manualAllocationSentences(notice: AllocationNotice): string[] {
  const sentences = [`Payment received today ${formatINR(notice.amount)}.`];
  if (notice.kind !== "installment") {
    if (notice.capped || notice.kind === "full") sentences.push("This covers the outstanding balance.");
    return sentences;
  }
  if (notice.capped) {
    sentences.push("This covers the outstanding balance.");
    return sentences;
  }
  const partial = notice.lines.filter((l) => !l.fullyPaid && l.remaining > 0);
  const opened = notice.lines.filter((l) => l.applied > 0);
  if (opened.length === 0) return sentences;
  sentences.push("This will be applied toward the earliest unpaid installment.");
  if (partial.length === 1 && opened.length === 1) {
    sentences.push(`${formatINR(partial[0]!.remaining)} will remain due.`);
  } else if (opened.length > 1) {
    for (const line of opened) {
      if (line.fullyPaid) sentences.push(`${formatINR(line.applied)} settles ${line.label}.`);
      else sentences.push(`${formatINR(line.applied)} toward ${line.label}. ${formatINR(line.remaining)} will remain due.`);
    }
  }
  return sentences;
}
