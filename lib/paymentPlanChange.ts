/**
 * PURE engine for converting an existing enrollment's payment plan between
 * FULL / EMI / CUSTOM_INSTALLMENTS. Operates only on the schedule (the single
 * source of truth) and never does I/O. All paid lines are ALWAYS preserved;
 * only outstanding (unpaid, non-cancelled/waived) lines are restructured.
 *
 * Access safety: the resulting schedule feeds the SAME 15-day grace rule in
 * lib/entitlements.ts. A line whose due date is already >15 days in the past
 * would immediately revoke access — the engine flags this and refuses to build
 * it unless the caller explicitly confirms (confirmBackdated).
 */
import { addDaysISO, addMonthsISO } from "./dates";
import { deriveEnrollment } from "./installments";
import type { CourseEnrollment, InstallmentItem, PaymentPlan } from "./types";

export const ACCESS_GRACE_DAYS = 15;
const DAY_MS = 86_400_000;

export interface CustomLineInput {
  title: string;
  amount: number;
  /** ISO date (required for any non-cancelled line). */
  due: string | null;
  grace?: string | null;
  notes?: string | null;
  status?: "pending" | "waived" | "cancelled";
}

export interface PlanChangeResult {
  schedule: InstallmentItem[];
  planType: "full" | "emi";
  paymentPlan: PaymentPlan;
  installmentCount: number;
  /** New total_fee to persist (only differs from current for confirmed custom changes). */
  totalFee: number;
  warnings: string[];
}

export type PlanChangeOutcome = { ok: true; result: PlanChangeResult } | { ok: false; error: string };

export interface ConvertOptions {
  bookingISO?: string;
  firstIntervalDays?: number;
  intervalMonths?: number;
  changedBy?: string | null;
  confirmBackdated?: boolean;
  confirmDifference?: boolean;
}

export interface ChangePlanTarget {
  plan: PaymentPlan;
  /** EMI: number of installments. */
  count?: number | null;
  /** CUSTOM_INSTALLMENTS: the staff-defined lines. */
  lines?: CustomLineInput[];
}

// --------------------------- helpers ---------------------------
const round = (n: number) => Math.round(Number(n) || 0);
const paidLinesOf = (e: CourseEnrollment) => (e.schedule || []).filter((s) => s.paid);
const maxNo = (lines: InstallmentItem[]) => lines.reduce((m, s) => Math.max(m, s.no), -1);

/** Earliest outstanding (unpaid, non-cancelled/waived) due date in ISO, else null. */
function earliestOutstandingDue(e: CourseEnrollment): string | null {
  const dated = (e.schedule || [])
    .filter((s) => !s.paid && s.status !== "cancelled" && s.status !== "waived" && s.due)
    .map((s) => s.due as string)
    .sort((a, b) => (Date.parse(a) || 0) - (Date.parse(b) || 0));
  return dated[0] ?? null;
}

/** Lines whose due date is already >15 days past (would immediately revoke access). */
function backdatedLines(schedule: InstallmentItem[], now: number): InstallmentItem[] {
  const cutoff = now - ACCESS_GRACE_DAYS * DAY_MS;
  return schedule.filter(
    (s) => !s.paid && s.status !== "cancelled" && s.status !== "waived" && s.due != null && (Date.parse(s.due) || 0) < cutoff,
  );
}

// --------------------------- conversions ---------------------------
function toEmi(e: CourseEnrollment, count: number, opts: ConvertOptions): PlanChangeOutcome {
  const d = deriveEnrollment(e);
  if (d.remaining <= 0) return { ok: false, error: "Nothing is outstanding — there is no balance to split into installments." };
  if (!Number.isFinite(count) || count < 1) return { ok: false, error: "Choose at least 1 installment." };

  const kept = paidLinesOf(e);
  const bookingISO = opts.bookingISO || new Date().toISOString();
  const firstIntervalDays = opts.firstIntervalDays ?? 7;
  const intervalMonths = opts.intervalMonths ?? 1;
  const startNo = maxNo(kept) + 1;
  const nowMs = Date.parse(bookingISO) || Date.now();

  const base = Math.floor(d.remaining / count);
  const remainder = d.remaining - base * count;
  const firstDue = addDaysISO(bookingISO, firstIntervalDays);

  const newLines: InstallmentItem[] = [];
  for (let i = 1; i <= count; i++) {
    const isLast = i === count;
    newLines.push({
      no: startNo + (i - 1),
      kind: "installment",
      label: `Installment ${i} of ${count}`,
      amount: base + (isLast ? remainder : 0),
      due: i === 1 ? firstDue : addMonthsISO(firstDue, (i - 1) * intervalMonths),
      paid: false,
      status: "pending",
      is_custom: false,
      created_by: opts.changedBy ?? null,
      created_at: bookingISO,
    });
  }

  const schedule = [...kept, ...newLines];
  return finalize(schedule, "emi", "EMI", count, e.total_fee, nowMs, opts);
}

function toFull(e: CourseEnrollment, opts: ConvertOptions): PlanChangeOutcome {
  const d = deriveEnrollment(e);
  const kept = paidLinesOf(e);
  const bookingISO = opts.bookingISO || new Date().toISOString();
  const nowMs = Date.parse(bookingISO) || Date.now();

  if (d.remaining <= 0) {
    // Already fully covered → just FULL with the paid lines.
    return finalize(kept, "full", "FULL", 0, e.total_fee, nowMs, opts);
  }
  // One outstanding "Remaining balance" line. Keep the original earliest due date
  // so the SAME grace logic applies (EMI→FULL must not strand the student).
  const remainingLine: InstallmentItem = {
    no: maxNo(kept) + 1,
    kind: "installment",
    label: "Remaining balance",
    amount: d.remaining,
    due: earliestOutstandingDue(e),
    paid: false,
    status: "pending",
    is_custom: false,
    created_by: opts.changedBy ?? null,
    created_at: bookingISO,
  };
  return finalize([...kept, remainingLine], "full", "FULL", 1, e.total_fee, nowMs, opts);
}

function toCustom(e: CourseEnrollment, lines: CustomLineInput[], opts: ConvertOptions): PlanChangeOutcome {
  if (!lines || lines.length === 0) return { ok: false, error: "Add at least one installment line." };
  const d = deriveEnrollment(e);
  const kept = paidLinesOf(e);
  const bookingISO = opts.bookingISO || new Date().toISOString();
  const nowMs = Date.parse(bookingISO) || Date.now();
  const startNo = maxNo(kept) + 1;

  const newLines: InstallmentItem[] = [];
  let outstandingSum = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const title = (ln.title || "").trim();
    const amount = round(ln.amount);
    const status = ln.status || "pending";
    if (!title) return { ok: false, error: `Line ${i + 1}: a title is required.` };
    if (amount <= 0) return { ok: false, error: `Line ${i + 1} ("${title}"): amount must be greater than 0.` };
    if (status !== "cancelled" && status !== "waived" && !ln.due) {
      return { ok: false, error: `Line ${i + 1} ("${title}"): a due date is required.` };
    }
    if (status !== "cancelled" && status !== "waived") outstandingSum += amount;
    newLines.push({
      no: startNo + i,
      kind: "installment",
      label: title,
      amount,
      due: ln.due || null,
      grace: ln.grace || null,
      paid: false,
      status,
      is_custom: true,
      created_by: opts.changedBy ?? null,
      cancelled_reason: status === "cancelled" || status === "waived" ? "Set by admin during custom plan build" : null,
      notes: ln.notes || null,
      created_at: bookingISO,
    });
  }

  // The outstanding lines should sum to the current remaining. A difference means
  // the admin is changing the effective fee (discount / extra charge) — only allow
  // with explicit confirmation, and adjust total_fee so totals reconcile.
  let totalFee = e.total_fee;
  if (outstandingSum !== d.remaining) {
    if (!opts.confirmDifference) {
      return {
        ok: false,
        error: `Installments total ${outstandingSum} but the outstanding balance is ${d.remaining}. Re-confirm to change the effective fee.`,
      };
    }
    totalFee = d.paid + outstandingSum;
    if (totalFee < d.paid) return { ok: false, error: "Total fee cannot be less than the amount already paid." };
  }

  return finalize([...kept, ...newLines], "emi", "CUSTOM_INSTALLMENTS", newLines.filter((l) => l.status !== "cancelled" && l.status !== "waived").length, totalFee, nowMs, opts);
}

function finalize(
  schedule: InstallmentItem[],
  planType: "full" | "emi",
  paymentPlan: PaymentPlan,
  installmentCount: number,
  totalFee: number,
  nowMs: number,
  opts: ConvertOptions,
): PlanChangeOutcome {
  const warnings: string[] = [];
  const backdated = backdatedLines(schedule, nowMs);
  if (backdated.length > 0) {
    if (!opts.confirmBackdated) {
      return {
        ok: false,
        error: `${backdated.length} installment due date(s) are more than ${ACCESS_GRACE_DAYS} days in the past. Saving this will immediately revoke the student's course access. Re-confirm to proceed.`,
      };
    }
    warnings.push(`${backdated.length} backdated due date(s) — access will be revoked until paid.`);
  }
  return { ok: true, result: { schedule, planType, paymentPlan, installmentCount, totalFee, warnings } };
}

/** Single entry point. Dispatches to the requested target plan. */
export function changePlan(e: CourseEnrollment, target: ChangePlanTarget, opts: ConvertOptions = {}): PlanChangeOutcome {
  switch (target.plan) {
    case "EMI":
      return toEmi(e, round(target.count ?? 0), opts);
    case "FULL":
      return toFull(e, opts);
    case "CUSTOM_INSTALLMENTS":
      return toCustom(e, target.lines || [], opts);
    default:
      return { ok: false, error: "Unknown payment plan." };
  }
}
