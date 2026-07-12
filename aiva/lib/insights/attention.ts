import { fetchPayments, fetchCourseEnrollments, fetchSmsForPhones } from "../data";
import { isPaidStatus, dedupePaidRows } from "@portal/lib/paymentsAgg";
import { isActiveEnrollment, isLineOutstanding } from "@portal/lib/installments";
import { getRevenueTower } from "../revenue/tower";
import { inr } from "../revenue/dailyBrief";
import { normPhone, pct } from "./calc";
import { paymentsLink, proofsLink, type PortalLink } from "../portal/links";
import type { Payment, CourseEnrollment, InstallmentItem } from "@portal/lib/types";

/**
 * "What needs my attention" — ranked, explainable read-only flags. Each flag carries the exact
 * calculation (numbers + rule), an optional drill metric to the underlying records, and portal
 * deep-links. All numbers reuse the SAME truth primitives as the Payments tab (isPaidStatus,
 * dedupePaidRows, deriveEnrollment) so they reconcile. Nothing here writes or acts.
 */

const DAY = 86_400_000;

export type FlagSeverity = "high" | "medium" | "low";
export type AttentionFlag = {
  id: string;
  score: number;
  severity: FlagSeverity;
  domain: string;
  title: string;
  /** Plain-English "why this matters". */
  why: string;
  /** The exact math/rule that triggered it. */
  calc: string;
  /** Drill metric key for the records behind the flag (opens the shared drill panel). */
  drill?: string;
  /** Portal deep-links (navigation only). */
  links: PortalLink[];
};

/** Pure: sort by score desc and keep the top N. Unit-tested. */
export function rankFlags(flags: AttentionFlag[], top = 5): AttentionFlag[] {
  return [...flags].sort((a, b) => b.score - a.score).slice(0, top);
}

/** Pure: weight severity, then scale by the money/volume at stake (log-ish, bounded). Unit-tested. */
export function flagScore(severity: FlagSeverity, magnitude: number): number {
  const base = severity === "high" ? 3000 : severity === "medium" ? 2000 : 1000;
  return base + Math.min(999, Math.log10(Math.max(1, magnitude)) * 140);
}

function windowSum(rows: Payment[], from: number, to: number): number {
  return rows.reduce((a, p) => {
    const t = Date.parse(p.created_at) || 0;
    return t >= from && t < to ? a + (Number(p.amount) || 0) : a;
  }, 0);
}

export async function getAttention(now = Date.now()): Promise<{ flags: AttentionFlag[]; all: AttentionFlag[] }> {
  const [tower, payments, enrollments] = await Promise.all([
    getRevenueTower(now),
    fetchPayments(),
    fetchCourseEnrollments(),
  ]);
  const flags: AttentionFlag[] = [];

  // 1) Overdue 15+ days (deep, hard money). Computed from live schedules.
  {
    const active = enrollments.filter((e) => isActiveEnrollment(e));
    let count = 0;
    let amount = 0;
    for (const e of active) {
      const schedule: InstallmentItem[] = Array.isArray(e.schedule) ? e.schedule : [];
      for (const line of schedule) {
        if (!isLineOutstanding(line)) continue;
        const od = line.due ? Math.floor((now - (Date.parse(line.due) || now)) / DAY) : 0;
        if (od >= 15) { count += 1; amount += Math.max(0, (Number(line.amount) || 0) - (Number(line.paid_amount) || 0)); }
      }
    }
    if (count > 0) {
      flags.push({
        id: "overdue-15plus",
        score: flagScore("high", amount),
        severity: "high",
        domain: "revenue",
        title: `${count} installment(s) overdue 15+ days`,
        why: "Payments this late rarely self-recover and are the biggest revenue-leak risk — they usually need a direct call, not another SMS.",
        calc: `Rule: outstanding installment lines whose due date is 15+ days before today. Result: ${count} line(s), ${inr(amount)} unpaid.`,
        drill: "revenue:overdue15",
        links: [paymentsLink()],
      });
    }
  }

  // 2) Paid but no active enrollment (access/ledger gap).
  if (tower.paidWithoutActiveEnrollment > 0) {
    flags.push({
      id: "paid-no-access",
      score: flagScore("high", tower.paidWithoutActiveEnrollment * 5000),
      severity: "high",
      domain: "revenue",
      title: `${tower.paidWithoutActiveEnrollment} paid, no active enrollment`,
      why: "Someone paid for a course but has no active enrollment record — they may be locked out of access they paid for, or the ledger is out of sync.",
      calc: `Rule: distinct phones with a PAID course payment (isPaidStatus) but no active enrollment (isActiveEnrollment). Result: ${tower.paidWithoutActiveEnrollment} phone(s).`,
      drill: "revenue:paidnoenroll",
      links: [paymentsLink()],
    });
  }

  // 3) Collections down vs prior 7 days (trend anomaly).
  {
    const paidRows = dedupePaidRows((payments as Payment[]).filter((p) => isPaidStatus(p.status)));
    const last7 = windowSum(paidRows, now - 7 * DAY, now);
    const prev7 = windowSum(paidRows, now - 14 * DAY, now - 7 * DAY);
    const change = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : last7 > 0 ? 100 : 0;
    if (prev7 > 0 && change <= -15) {
      flags.push({
        id: "collections-down",
        score: flagScore("medium", Math.abs(prev7 - last7)),
        severity: "medium",
        domain: "revenue",
        title: `Collections down ${Math.abs(change)}% vs last week`,
        why: "A sharp week-over-week drop in money collected is an early warning — worth checking before it compounds into the monthly numbers.",
        calc: `Deduped PAID rows: last 7d = ${inr(last7)} vs prior 7d = ${inr(prev7)} → ${change}%.`,
        drill: "revenue:recentpaid",
        links: [paymentsLink()],
      });
    }
  }

  // 4) Abandoned checkouts (recoverable).
  if (tower.abandoned.amount > 0) {
    flags.push({
      id: "abandoned",
      score: flagScore("medium", tower.abandoned.amount),
      severity: "medium",
      domain: "revenue",
      title: `${tower.abandoned.count} abandoned checkout(s)`,
      why: "These people tried to pay and didn't finish — the warmest recoverable leads you have.",
      calc: `Rule: payments with status = ABANDONED. Result: ${tower.abandoned.count} worth ${inr(tower.abandoned.amount)}.`,
      drill: "revenue:abandoned",
      links: [paymentsLink()],
    });
  }

  // 5) Active enrollments with ZERO SMS contact (engagement gap).
  {
    const active = enrollments.filter((e) => isActiveEnrollment(e));
    if (active.length > 0) {
      const smsRows = await fetchSmsForPhones(active.map((e) => e.phone));
      const withSms = new Set(smsRows.map((l) => normPhone(l.normalized_mobile || l.mobile)).filter(Boolean));
      const zero = active.filter((e) => !withSms.has(normPhone(e.phone)));
      if (zero.length > 0) {
        flags.push({
          id: "zero-sms",
          score: flagScore("medium", zero.length * 1000),
          severity: "medium",
          domain: "admissions",
          title: `${zero.length} enrolled student(s) never texted`,
          why: "Active students who have never received an SMS may be slipping through onboarding/reminders — a cheap gap to close.",
          calc: `Rule: active enrollments whose normalized phone has 0 rows in sms_logs. Result: ${zero.length} of ${active.length} active.`,
          drill: "admissions:nosms",
          links: [],
        });
      }
    }
  }

  // 6) Payment proofs awaiting review (ops backlog; deep-link only, no record drill).
  if (tower.proofsPending > 0) {
    flags.push({
      id: "proofs",
      score: flagScore("medium", tower.proofsPending * 800),
      severity: "medium",
      domain: "operations",
      title: `${tower.proofsPending} payment proof(s) awaiting review`,
      why: "Uploaded proofs block access until a human verifies them — a fast queue to clear.",
      calc: `Rule: payment_proofs in status submitted/reupload_requested. Result: ${tower.proofsPending}.`,
      links: [proofsLink()],
    });
  }

  // 7) Overdue 8+ days (from tower; medium if 15+ already surfaced).
  if (tower.overdue8plus.amount > 0) {
    flags.push({
      id: "overdue-8plus",
      score: flagScore("medium", tower.overdue8plus.amount),
      severity: "medium",
      domain: "revenue",
      title: `${tower.overdue8plus.count} installment(s) overdue 8+ days`,
      why: "A week-plus late — still recoverable with a nudge before it hardens.",
      calc: `Rule: outstanding lines due 8+ days ago. Result: ${tower.overdue8plus.count} worth ${inr(tower.overdue8plus.amount)}.`,
      drill: "revenue:aging:8plus",
      links: [paymentsLink()],
    });
  }

  if (flags.length === 0) {
    flags.push({
      id: "all-clear",
      score: 0,
      severity: "low",
      domain: "revenue",
      title: "Nothing urgent right now",
      why: "No deep-overdue installments, access anomalies, or collapse in collections detected.",
      calc: "All attention rules evaluated to zero.",
      links: [],
    });
  }

  return { flags: rankFlags(flags, 5), all: flags };
}
