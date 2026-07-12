import { fetchPayments, fetchCourseEnrollments, countOpenProofs } from "../data";
import { isPaidStatus, dedupePaidRows, dedupedPaidTotal } from "@portal/lib/paymentsAgg";
import { deriveEnrollment, isActiveEnrollment, isLineOutstanding } from "@portal/lib/installments";
import { memo } from "../cache";
import type { Payment, CourseEnrollment, InstallmentItem } from "@portal/lib/types";

/**
 * Read-only Revenue Control Tower. Reuses the portal's reconciliation primitives verbatim so
 * AIVA numbers tie out with the Payments tab / CEO Overview. NO mutations, NO reminders sent.
 */

export type Bucket = { count: number; amount: number };

export type RevenueTower = {
  collected: number;
  outstanding: number;
  expected: number;
  dueToday: Bucket;
  overdue1_3: Bucket;
  overdue4_7: Bucket;
  overdue8plus: Bucket;
  overdueTotal: Bucket;
  proofsPending: number;
  abandoned: Bucket;
  paidWithoutActiveEnrollment: number;
  activeEnrollments: number;
  atRiskRevenue: number;
  paidCount: number;
  generatedAt: string;
};

const DAY = 86_400_000;

function daysOverdue(dueISO: string | null | undefined, now: number): number {
  if (!dueISO) return 0;
  const due = new Date(dueISO).getTime();
  if (!Number.isFinite(due)) return 0;
  return Math.floor((now - due) / DAY);
}

export async function getRevenueTower(now = Date.now()): Promise<RevenueTower> {
  const [payments, enrollments] = await Promise.all([fetchPayments(), fetchCourseEnrollments()]);
  const proofsPending = await countOpenProofs();

  // Collected revenue (deduped PAID rows) — same as Payments tab.
  const paidRows = payments.filter((p: Payment) => isPaidStatus(p.status));
  const collected = dedupedPaidTotal(dedupePaidRows(paidRows));

  // Abandoned checkouts (value at risk).
  const abandonedRows = payments.filter((p: Payment) => String(p.status) === "ABANDONED");
  const abandoned: Bucket = {
    count: abandonedRows.length,
    amount: abandonedRows.reduce((s, p) => s + (Number(p.amount) || 0), 0),
  };

  // Outstanding + overdue from ACTIVE enrollment schedules (source of truth for per-course dues).
  const active = enrollments.filter((e: CourseEnrollment) => isActiveEnrollment(e));
  let outstanding = 0;
  const dueToday: Bucket = { count: 0, amount: 0 };
  const o13: Bucket = { count: 0, amount: 0 };
  const o47: Bucket = { count: 0, amount: 0 };
  const o8: Bucket = { count: 0, amount: 0 };

  for (const enr of active) {
    const d = deriveEnrollment(enr);
    outstanding += d.remaining;
    const schedule: InstallmentItem[] = Array.isArray(enr.schedule) ? enr.schedule : [];
    for (const line of schedule) {
      if (!isLineOutstanding(line)) continue;
      const amt = Math.max(0, (Number(line.amount) || 0) - (Number(line.paid_amount) || 0));
      const od = daysOverdue(line.due, now);
      if (od < 0) continue;
      if (od === 0) {
        dueToday.count += 1;
        dueToday.amount += amt;
      } else if (od <= 3) {
        o13.count += 1;
        o13.amount += amt;
      } else if (od <= 7) {
        o47.count += 1;
        o47.amount += amt;
      } else {
        o8.count += 1;
        o8.amount += amt;
      }
    }
  }

  const overdueTotal: Bucket = {
    count: o13.count + o47.count + o8.count,
    amount: o13.amount + o47.amount + o8.amount,
  };

  // Paid-without-active-enrollment anomaly (conservative advisory signal).
  const activePhones = new Set(active.map((e) => normPhone(e.phone)));
  const paidCoursePhones = new Set(
    paidRows.filter((p) => String(p.item_type) === "course").map((p) => normPhone(p.phone)),
  );
  let paidWithoutActiveEnrollment = 0;
  for (const ph of paidCoursePhones) if (ph && !activePhones.has(ph)) paidWithoutActiveEnrollment += 1;

  return {
    collected,
    outstanding,
    expected: collected + outstanding,
    dueToday,
    overdue1_3: o13,
    overdue4_7: o47,
    overdue8plus: o8,
    overdueTotal,
    proofsPending,
    abandoned,
    paidWithoutActiveEnrollment,
    activeEnrollments: active.length,
    atRiskRevenue: overdueTotal.amount + abandoned.amount,
    paidCount: paidRows.length,
    generatedAt: new Date(now).toISOString(),
  };
}

function normPhone(p: string | null | undefined): string {
  return String(p || "").replace(/\D/g, "").slice(-10);
}

/**
 * 60-second memoized tower. The assistant's data tools call this so one chat turn that hits
 * several tools recomputes the reconciliation truth at most once per minute. Reconciles
 * identically to getRevenueTower (same code path); only the result is cached.
 */
export function getRevenueTowerCached(): Promise<RevenueTower> {
  return memo("revenue-tower", 60_000, () => getRevenueTower(Date.now()));
}
