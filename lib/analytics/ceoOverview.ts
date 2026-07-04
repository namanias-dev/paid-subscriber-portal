/**
 * CEO Overview — the daily-glance dashboard behind /admin.
 *
 * RECONCILIATION RULE (same as lib/analytics/queries.ts): every money/seat number
 * is derived from the `payments` table via lib/paymentsAgg (PAID-wins + retry
 * dedupe — the SAME primitives the Payments tab and Business Analytics use), so
 * the Overview always ties out to both. Behaviour/funnel numbers come from the
 * analytics event log via the existing reconciled query functions.
 *
 * This module COMPOSES the already-reconciled layer rather than reimplementing it:
 *   • headline glance numbers            → getAnalyticsOverview (current + prior)
 *   • revenue / success-rate day trend   → getAnalyticsTimeseries
 *   • webinar funnel + per-webinar table  → getWebinarFunnel
 * The only bespoke computations are the ones no existing function exposes
 * (revenue by product line, new-paying-customers, at-risk ₹, today snapshot,
 * upcoming webinars, attention signals) — all built from the SAME primitives and
 * the SAME exclude-admin filter, so they reconcile with the headline numbers.
 */
import { getPayments, getWebinars, getAllWebinarRegistrations, getAllCourseEnrollments } from "../dataProvider";
import { isPaidStatus, dedupePaidRows, dedupedPaidTotal, distinctRegistrations, itemKey } from "../paymentsAgg";
import { deriveEnrollment, isActiveEnrollment } from "../installments";
import { normPhone } from "../phone";
import {
  getAnalyticsOverview, getAnalyticsTimeseries, getWebinarFunnel, resolveRange,
  fetchEvents, getTrackingStartMs, getStaffPhoneSet, countSubmittedProofs,
  type RangePreset,
} from "./queries";
import type { Payment } from "../types";

/** A headline number with a prior-period comparison. */
export interface GlanceMetric {
  /** Current-period value (money in ₹, a count, or a % depending on the metric). */
  value: number | null;
  /** Prior equal-length period value, for the comparison. */
  prev: number | null;
  /** Percent change vs prior period (null when prior is 0/unknown). */
  deltaPct: number | null;
  /** Percentage-POINT change vs prior period — set only for rate metrics. */
  deltaPts: number | null;
  /** Whether this metric is a rate (%) rather than a count/amount. */
  isRate: boolean;
  /** Whether this metric is money (₹) — used for permission gating + formatting. */
  isMoney: boolean;
}

export type LineKey = "course" | "webinar" | "plan";

export interface CeoOverviewResult {
  range: { from: string; to: string };
  prevRange: { from: string; to: string };
  preset: RangePreset;
  excludeAdmin: boolean;
  canRevenue: boolean;
  generatedAt: string;
  glance: {
    revenue: GlanceMetric;
    paidStudents: GlanceMetric;
    successRate: GlanceMetric;
    registrationToPaid: GlanceMetric;
    newPayingCustomers: GlanceMetric;
    avgRevenuePerStudent: GlanceMetric;
  };
  money: {
    revenueByLine: { line: LineKey; label: string; revenue: number; paidStudents: number }[];
    refunds: number;
    atRisk: {
      verifyingAmount: number;
      abandonedValue: number;
      courseOutstanding: number;
      total: number;
    };
    trend: { day: string; revenue: number; paid: number }[];
  };
  funnel: {
    steps: { label: string; value: number; conversionFromPrev: number | null }[];
    topWebinars: { slug: string; title: string; registrations: number; paid: number; attended: number; revenue: number }[];
    successTrend: { day: string; rate: number | null }[];
  };
  attention: { id: string; severity: "danger" | "warn" | "info"; label: string; detail: string }[];
  today: {
    revenue: number;
    paidRegistrations: number;
    webinarPaid: number;
    coursePaid: number;
    planPaid: number;
    upcomingWebinars: { slug: string; title: string; datetime: string; registrations: number; paid: number }[];
  };
  future: string[];
}

const LINE_LABEL: Record<LineKey, string> = { course: "Courses", webinar: "Webinars", plan: "Plans" };
const IST_MS = 5.5 * 3600 * 1000;

function istYmd(iso: string): string {
  return new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
}

/** % change (rounded to 1dp). null when there's no meaningful base. */
function pctChange(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** percentage-POINT change (rounded to 1dp). */
function ptsChange(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return Math.round((cur - prev) * 10) / 10;
}

function countMetric(value: number | null, prev: number | null, isMoney = false): GlanceMetric {
  return { value, prev, deltaPct: pctChange(value, prev), deltaPts: null, isRate: false, isMoney };
}
function rateMetric(value: number | null, prev: number | null): GlanceMetric {
  return { value, prev, deltaPct: null, deltaPts: ptsChange(value, prev), isRate: true, isMoney: false };
}

/**
 * First-ever paid timestamp (UTC ms) per student phone, across ALL time. A student
 * counts as a "new paying customer" in a period when this first-paid moment falls
 * inside it. Uses the SAME paid definition (isPaidStatus) as every other metric.
 */
function firstPaidMsByPhone(payments: Payment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payments) {
    if (p.deleted_at || !isPaidStatus(p.status)) continue;
    const ph = normPhone(p.phone);
    if (!ph) continue;
    const t = new Date(p.created_at).getTime();
    const prev = map.get(ph);
    if (prev === undefined || t < prev) map.set(ph, t);
  }
  return map;
}

function newPayingInWindow(firstPaid: Map<string, number>, fromMs: number, toMs: number): number {
  let n = 0;
  for (const t of firstPaid.values()) if (t >= fromMs && t <= toMs) n++;
  return n;
}

export async function getCeoOverview(opts: {
  preset: RangePreset;
  from?: string | null;
  to?: string | null;
  excludeAdmin?: boolean;
  canRevenue: boolean;
}): Promise<CeoOverviewResult> {
  const { from, to } = resolveRange(opts.preset, opts.from, opts.to);
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const spanMs = Math.max(1, toMs - fromMs);
  const prevTo = new Date(fromMs).toISOString();
  const prevFrom = new Date(fromMs - spanMs).toISOString();
  const prevFromMs = new Date(prevFrom).getTime();
  const prevToMs = new Date(prevTo).getTime();
  const excludeAdmin = !!opts.excludeAdmin;

  // PERF: this endpoint composes four analytics aggregations that each USED to
  // independently re-fetch the same events + payments (5× getPayments, 4× the full
  // 50k-row event scan → ~9 s). We now load every raw input ONCE and inject it into
  // the (unchanged) aggregation functions, so the numbers are byte-identical but the
  // work happens a single time. Current + prior event scans run in parallel here, so
  // the wall time is one scan — not four serial ones. (Prior uses the SAME capped
  // fetchEvents, not a narrower query, so its registration count matches the
  // pre-refactor value exactly even when a window exceeds the 50k row cap.)
  const [allPaymentsRaw, eventsCur, eventsPrev, trackingStartMs, staffPhones, proofPending, webinars, regs, courseEnrollments] = await Promise.all([
    getPayments(),
    fetchEvents(from, to),
    fetchEvents(prevFrom, prevTo),
    getTrackingStartMs(),
    excludeAdmin ? getStaffPhoneSet() : Promise.resolve(new Set<string>()),
    countSubmittedProofs(),
    getWebinars(),
    getAllWebinarRegistrations(),
    getAllCourseEnrollments(),
  ]);

  // Reconciled headline numbers from the existing analytics layer (now fed the
  // shared data), so the glance six tie out to Business Analytics for the same range.
  const ov = await getAnalyticsOverview({ from, to, excludeAdmin }, {
    events: eventsCur, payments: allPaymentsRaw, trackingStartMs, staffPhones, proofPending,
  });
  const ovPrev = await getAnalyticsOverview({ from: prevFrom, to: prevTo, excludeAdmin }, {
    events: eventsPrev, payments: allPaymentsRaw, trackingStartMs, staffPhones, proofPending,
  });
  const ts = await getAnalyticsTimeseries({ from, to, excludeAdmin }, {
    // The revenue/paid/success trend is derived entirely from payments; events and
    // quiz attempts don't feed any field the Overview reads, so we skip loading them.
    events: [], payments: allPaymentsRaw, staff: staffPhones, attempts: [],
  });
  const funnel = await getWebinarFunnel({ from, to, excludeAdmin }, {
    events: eventsCur, payments: allPaymentsRaw, staff: staffPhones, webinars, regs,
  });

  // Working payment set: not-deleted, and (when excludeAdmin) staff-excluded by the
  // SAME rule the analytics layer uses — so every bespoke slice below reconciles.
  const notStaff = (p: Payment) => !(excludeAdmin && p.phone && staffPhones.has(normPhone(p.phone)!));
  const payments = allPaymentsRaw.filter((p) => !p.deleted_at && notStaff(p));

  // ---- Glance six (trustworthy hard numbers) ----
  const glance = {
    revenue: countMetric(ov.kpis.revenue, ovPrev.kpis.revenue, true),
    paidStudents: countMetric(ov.kpis.paidStudents, ovPrev.kpis.paidStudents),
    successRate: rateMetric(ov.conversions.paymentToPaid, ovPrev.conversions.paymentToPaid),
    registrationToPaid: rateMetric(ov.conversions.registrationToPaid, ovPrev.conversions.registrationToPaid),
    newPayingCustomers: countMetric(0, 0),
    avgRevenuePerStudent: countMetric(ov.conversions.avgRevenuePerStudent, ovPrev.conversions.avgRevenuePerStudent, true),
  };

  // New paying customers (first-ever paid in range) — bespoke, from full payments.
  const firstPaid = firstPaidMsByPhone(payments);
  glance.newPayingCustomers = countMetric(
    newPayingInWindow(firstPaid, fromMs, toMs),
    newPayingInWindow(firstPaid, prevFromMs, prevToMs),
  );

  // ---- In-range payment slices ----
  const inRange = (p: Payment) => { const t = new Date(p.created_at).getTime(); return t >= fromMs && t <= toMs; };
  const rangePayments = payments.filter(inRange);

  // Revenue by product line — per item_type dedupe sums EXACTLY to ov.kpis.revenue
  // because dedupe keys are per-item (distinct item_types never merge).
  const revenueByLine = (Object.keys(LINE_LABEL) as LineKey[]).map((line) => {
    const raw = rangePayments.filter((p) => p.item_type === line && isPaidStatus(p.status));
    const studentSet = new Set<string>();
    for (const p of dedupePaidRows(raw)) { const ph = normPhone(p.phone); if (ph) studentSet.add(ph); }
    return { line, label: LINE_LABEL[line], revenue: dedupedPaidTotal(raw), paidStudents: studentSet.size };
  }).sort((a, b) => b.revenue - a.revenue);

  // Refunds (in range).
  const refunds = rangePayments.filter((p) => (p.status || "").toUpperCase() === "REFUNDED").reduce((a, p) => a + (p.amount || 0), 0);

  // ---- At-risk ₹ (proxy) ----
  // Paid (phone|item) set across ALL time → PAID-wins so we never flag ₹ for a
  // purchase that later succeeded.
  const paidItemKeys = new Set<string>();
  for (const p of payments) if (isPaidStatus(p.status)) { const ph = normPhone(p.phone); if (ph) paidItemKeys.add(`${ph}|${itemKey(p)}`); }
  const verifyingRows = rangePayments.filter((p) => (p.status || "").toUpperCase() === "VERIFYING");
  const verifyingAmount = verifyingRows.reduce((a, p) => a + (p.amount || 0), 0);
  const abandonedRaw = rangePayments.filter((p) => {
    const s = (p.status || "").toUpperCase();
    if (s !== "ABANDONED" && s !== "FAILED") return false;
    const ph = normPhone(p.phone);
    return !(ph && paidItemKeys.has(`${ph}|${itemKey(p)}`));
  });
  const abandonedValue = dedupePaidRows(abandonedRaw).reduce((a, p) => a + (p.amount || 0), 0);
  // Course fees still outstanding — from the TRUSTED course_enrollments source
  // (installment schedule), never the legacy `enrollments` table.
  const courseOutstanding = courseEnrollments
    .filter((e) => isActiveEnrollment(e))
    .reduce((a, e) => a + deriveEnrollment(e).remaining, 0);
  const atRiskTotal = verifyingAmount + abandonedValue + courseOutstanding;

  // ---- Trends (from reconciled timeseries) ----
  const trend = ts.points.map((p) => ({ day: p.day, revenue: p.revenue, paid: p.paid }));
  const successTrend = ts.points.map((p) => ({ day: p.day, rate: p.paymentsInitiated > 0 ? Math.round((p.paid / p.paymentsInitiated) * 1000) / 10 : null }));

  // ---- Attention signals (only triggered chips; each shows its value) ----
  const attention: CeoOverviewResult["attention"] = [];
  if (glance.successRate.value !== null && glance.successRate.deltaPts !== null && glance.successRate.deltaPts <= -10) {
    attention.push({ id: "success_drop", severity: "danger", label: "Payment success rate falling", detail: `↓${Math.abs(glance.successRate.deltaPts)}pts vs prior period (now ${glance.successRate.value}%)` });
  }
  for (const w of funnel.webinars) {
    if (w.registrations >= 25) {
      const rate = Math.round((w.paid / w.registrations) * 1000) / 10;
      if (rate < 10) attention.push({ id: `weak_webinar_${w.slug}`, severity: "warn", label: `Low paid conversion — ${w.title}`, detail: `${w.registrations} registrations · only ${w.paid} paid (${rate}%)` });
    }
  }
  const failAbandon = (rows: Payment[]) => rows.filter((p) => { const s = (p.status || "").toUpperCase(); return s === "ABANDONED" || s === "FAILED"; }).length;
  const failAbandonCur = failAbandon(rangePayments);
  const failAbandonPrev = failAbandon(payments.filter((p) => { const t = new Date(p.created_at).getTime(); return t >= prevFromMs && t <= prevToMs; }));
  if (failAbandonCur >= 10 && failAbandonPrev > 0 && failAbandonCur >= failAbandonPrev * 1.5) {
    const up = Math.round(((failAbandonCur - failAbandonPrev) / failAbandonPrev) * 100);
    attention.push({ id: "failabandon_spike", severity: "warn", label: "Failed / abandoned checkouts spiking", detail: `${failAbandonCur} this period · ↑${up}% vs prior (${failAbandonPrev})` });
  }
  if (verifyingAmount > 0 && verifyingRows.length >= 3) {
    attention.push({ id: "stuck_verifying", severity: "info", label: "Money stuck verifying", detail: `₹${verifyingAmount.toLocaleString("en-IN")} across ${verifyingRows.length} payments awaiting confirmation` });
  }

  // ---- Today snapshot (always IST today, independent of the range control) ----
  const todayYmd = istYmd(new Date().toISOString());
  const paidToday = payments.filter((p) => isPaidStatus(p.status) && istYmd(p.created_at) === todayYmd);
  const today = {
    revenue: dedupedPaidTotal(paidToday),
    paidRegistrations: distinctRegistrations(paidToday),
    webinarPaid: distinctRegistrations(paidToday.filter((p) => p.item_type === "webinar")),
    coursePaid: distinctRegistrations(paidToday.filter((p) => p.item_type === "course")),
    planPaid: distinctRegistrations(paidToday.filter((p) => p.item_type === "plan")),
    upcomingWebinars: [] as CeoOverviewResult["today"]["upcomingWebinars"],
  };

  // Upcoming webinars (next few by datetime) with honest paid-distinct counts.
  const nowMs = Date.now();
  const idToWeb = new Map(webinars.map((w) => [w.id, w] as const));
  const regBySlug = new Map<string, number>();
  for (const r of regs) { const w = idToWeb.get(r.webinar_id); if (w) regBySlug.set(w.slug, (regBySlug.get(w.slug) || 0) + 1); }
  const paidWebBySlug = new Map<string, number>();
  for (const p of dedupePaidRows(payments.filter((p) => p.item_type === "webinar" && isPaidStatus(p.status)))) {
    const s = (p.item_slug || "").toLowerCase();
    paidWebBySlug.set(s, (paidWebBySlug.get(s) || 0) + 1);
  }
  today.upcomingWebinars = webinars
    .filter((w) => w.datetime && new Date(w.datetime).getTime() >= nowMs && w.status !== "completed")
    .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())
    .slice(0, 5)
    .map((w) => ({ slug: w.slug, title: w.title, datetime: w.datetime, registrations: regBySlug.get(w.slug) || 0, paid: paidWebBySlug.get(w.slug.toLowerCase()) || 0 }));

  const result: CeoOverviewResult = {
    range: { from, to },
    prevRange: { from: prevFrom, to: prevTo },
    preset: opts.preset,
    excludeAdmin,
    canRevenue: opts.canRevenue,
    generatedAt: new Date().toISOString(),
    glance,
    money: {
      revenueByLine,
      refunds,
      atRisk: { verifyingAmount, abandonedValue, courseOutstanding, total: atRiskTotal },
      trend,
    },
    funnel: {
      steps: funnel.steps,
      topWebinars: funnel.webinars.slice(0, 8),
      successTrend,
    },
    attention,
    today,
    future: [
      "Lifetime value (LTV) & customer acquisition cost (CAC) — needs ad-spend + cost instrumentation.",
      "Retention / churn — needs a recurring-billing or renewal model to measure.",
      "Test-series revenue line — needs product tagging before it can be shown as a number.",
      "Webinar attendance — currently a Zoom-click proxy, not a true attendance signal.",
    ],
  };

  // Strip money for accounts without revenue permission (server-side, not just UI).
  if (!opts.canRevenue) {
    result.glance.revenue = countMetric(null, null, true);
    result.glance.avgRevenuePerStudent = countMetric(null, null, true);
    result.money.revenueByLine = result.money.revenueByLine.map((r) => ({ ...r, revenue: 0 }));
    result.money.refunds = 0;
    result.money.atRisk = { verifyingAmount: 0, abandonedValue: 0, courseOutstanding: 0, total: 0 };
    result.money.trend = result.money.trend.map((d) => ({ ...d, revenue: 0 }));
    result.today.revenue = 0;
    result.funnel.topWebinars = result.funnel.topWebinars.map((w) => ({ ...w, revenue: 0 }));
  }

  return result;
}
