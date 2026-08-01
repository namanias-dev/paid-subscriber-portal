/**
 * Executive Overview — factual command dashboard behind /admin.
 *
 * RECONCILIATION (must match Payments & Finance / ceoOverview):
 *  • Paid webinar registrations → payments where isPaidStatus + item_type=webinar
 *    + distinctRegistrations (phone×item). NEVER raw webinar_registrations rows.
 *  • Seat bookings → paid course payments with payment_kind=seat, distinct.
 *  • Revenue → dedupedPaidTotal on confirmed payments only.
 *  • Visitors / logins → analytics_events (visitor_id / login events).
 *  • Day boundaries → istYMD / resolveRange (Asia/Kolkata).
 *
 * Progressive load:
 *  • part=pulse — KPIs + 30d history (fast first paint)
 *  • part=body  — remaining sections (fetched when scrolled into view)
 */
import {
  getPayments,
  getWebinars,
  getAllWebinarRegistrations,
  getAllCourseEnrollments,
  getAllCourses,
  getBuyers,
  getLeads,
  getAllAttempts,
  getAllQuizzes,
  getCaArticles,
  getCaPdfs,
  getAllAccessOverrides,
} from "../dataProvider";
import { isPaidStatus, dedupedPaidTotal, distinctRegistrations, itemKey } from "../paymentsAgg";
import { deriveEnrollment, deriveCollections, isActiveEnrollment } from "../installments";
import { lectureAccessForCourse } from "../entitlements";
import { classifyAccessAtRisk } from "../accessAtRisk";
import { normPhone } from "../phone";
import { listLogs } from "../sms/store";
import { istYMD, istTodayYMD } from "../dates";
import { buildWebinarByDay, paidWebinarRegsOnYmd } from "../webinarReg";
import { ttlCached } from "../ttlCache";
import {
  resolveRange,
  fetchEvents,
  getTrackingStartMs,
  getStaffPhoneSet,
  getAnalyticsOverview,
  getAnalyticsTimeseries,
  type RangePreset,
  type EventLite,
  type OverviewPre,
} from "./queries";
import type { Payment, CourseEnrollment, Webinar, Lead, CourseAccessOverride } from "../types";

/** Shared short-lived payments snapshot so pulse + body don't double-scan. */
async function cachedPayments(): Promise<Payment[]> {
  const { value } = await ttlCached("exec-overview:payments:v1", 20_000, () => getPayments());
  return value;
}

export type ExecPreset = Exclude<RangePreset, "custom" | "yesterday"> | "all_time";
export type ExecPart = "pulse" | "body" | "full";

export interface MetricDelta {
  value: number | null;
  prev: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  scope: "today" | "period" | "all_time";
  unavailableReason?: string;
}

export interface SparkPoint {
  day: string;
  value: number;
}

export interface RankedPage {
  path: string;
  views: number;
  uniqueVisitors: number;
  clicks: number;
  prevViews: number | null;
}

export interface WebinarRow {
  id: string;
  slug: string;
  title: string;
  datetime: string;
  /** Paid distinct registrations (Payments methodology). */
  registrations: number;
  paid: number;
  revenue: number;
  conversionPct: number | null;
  status: { paid: number; abandoned: number; failed: number; pending: number };
}

export interface CourseRow {
  courseId: string;
  slug: string;
  title: string;
  batchStart: string | null;
  seatBookings: number;
  confirmedAdmissions: number;
  revenue: number;
  progressLabel: string;
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

/** Always-present history for sparklines + explorer (IST days). */
export interface HistorySeries {
  visitors: SparkPoint[];
  logins: SparkPoint[];
  loginUsers: SparkPoint[];
  webinarPaid: SparkPoint[];
  leads: SparkPoint[];
  seatBookings: SparkPoint[];
  webinarRevenue: SparkPoint[];
  courseRevenue: SparkPoint[];
}

export interface ExecutivePulse {
  generatedAt: string;
  range: { from: string; to: string };
  prevRange: { from: string; to: string };
  preset: ExecPreset;
  excludeAdmin: boolean;
  canRevenue: boolean;
  pulse: {
    visitorsToday: MetricDelta;
    loginUsersToday: MetricDelta;
    loginCodesToday: MetricDelta;
    leadsToday: MetricDelta;
    /** Paid webinar registrations today — matches Payments "Webinar Registrations Today". */
    webinarRegsToday: MetricDelta;
    seatBookingsToday: MetricDelta;
    webinarRevenue: MetricDelta;
    courseRevenue: MetricDelta;
  };
  history: HistorySeries;
  unavailable: string[];
}

export interface ExecutiveBody {
  generatedAt: string;
  activity: {
    visitors: MetricDelta;
    pageViews: MetricDelta;
    logins: MetricDelta;
    loginUsers: MetricDelta;
    loginCodesGenerated: MetricDelta;
    visitorTrend: SparkPoint[];
    loginTrend: SparkPoint[];
    loginAverages: { daily: number | null; weekly: number | null; monthly: number | null };
    topPages: RankedPage[];
    newVsReturningLogins: { newUsers: number | null; returningUsers: number | null; unavailableReason?: string };
  };
  leads: {
    totalPeriod: MetricDelta;
    today: MetricDelta;
    metaToday: MetricDelta;
    metaPeriod: MetricDelta;
    trend: SparkPoint[];
    bySource: { source: string; count: number }[];
  };
  webinars: {
    regsToday: MetricDelta;
    revenue: MetricDelta;
    trend: SparkPoint[];
    top: WebinarRow[];
    recent: WebinarRow[];
    paymentFunnel: { paid: number; abandoned: number; failed: number; pending: number };
  };
  courses: {
    seatBookingsToday: MetricDelta;
    seatBookingsAllTime: MetricDelta;
    revenue: MetricDelta;
    trend: SparkPoint[];
    top: CourseRow[];
    recent: CourseRow[];
  };
  admissionFunnel: {
    stages: FunnelStage[];
    byCourse: { courseId: string; title: string; stages: FunnelStage[] }[];
  };
  collections: {
    overdueCount: MetricDelta;
    overdueAmount: MetricDelta;
    blockedCount: MetricDelta;
    graceCount: MetricDelta;
    aging: { bucket: string; count: number; amount: number }[];
    upcomingDue: { count: number; amount: number };
  };
  engagement: {
    quizAttemptsToday: MetricDelta;
    quizUniqueToday: MetricDelta;
    quizTrend: SparkPoint[];
    topQuizzes: { id: string; title: string; attempts: number; uniqueStudents: number }[];
    caTop: { slug: string; title: string; views: number }[];
    resourceDownloads: { id: string; title: string; downloads: number }[];
    resourceDownloadEvents: MetricDelta;
  };
  sms: {
    sent: number;
    delivered: number | null;
    failed: number;
    pending: number;
    deliveryRate: number | null;
    failureRate: number | null;
    deliveryKnown: boolean;
    trend: SparkPoint[];
  };
  unavailable: string[];
}

export type ExecutiveOverview = ExecutivePulse & ExecutiveBody;

function pctChange(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function metric(value: number | null, prev: number | null, scope: MetricDelta["scope"], unavailableReason?: string): MetricDelta {
  return {
    value,
    prev,
    deltaAbs: value !== null && prev !== null ? value - prev : null,
    deltaPct: pctChange(value, prev),
    scope,
    unavailableReason,
  };
}

function inRange(iso: string, fromMs: number, toMs: number): boolean {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= fromMs && t <= toMs;
}

function resolveExecRange(
  preset: ExecPreset,
  fromStr?: string | null,
  toStr?: string | null,
): { from: string; to: string; prevFrom: string; prevTo: string } {
  if (preset === "all_time") {
    const from = "2020-01-01T00:00:00.000Z";
    const to = new Date().toISOString();
    return { from, to, prevFrom: from, prevTo: from };
  }
  const r = resolveRange(preset, fromStr, toStr);
  const fromMs = new Date(r.from).getTime();
  const toMs = new Date(r.to).getTime();
  const span = Math.max(1, toMs - fromMs);
  return {
    from: r.from,
    to: r.to,
    prevFrom: new Date(fromMs - span).toISOString(),
    prevTo: new Date(fromMs - 1).toISOString(),
  };
}

function isMetaLead(l: Lead): boolean {
  if (l.meta_leadgen_id) return true;
  const s = `${l.source || ""} ${l.first_source || ""}`.toLowerCase();
  return /\bmeta\b|facebook|fbclid|lead.?ad/.test(s);
}

function seatPaidEnrollment(e: CourseEnrollment): boolean {
  const d = deriveEnrollment(e);
  if (d.seatPaid) return true;
  return (e.schedule || []).some((s) => s.kind === "seat" && s.paid);
}

function installmentPaidCount(e: CourseEnrollment): number {
  return (e.schedule || []).filter((s) => s.kind === "installment" && s.paid).length;
}

/** Exported for unit tests — unique active enrollments, cumulative stages. */
export function buildAdmissionStages(enrollments: CourseEnrollment[]): FunnelStage[] {
  const active = enrollments.filter((e) => isActiveEnrollment(e) && e.status !== "cancelled" && e.status !== "transferred_out");
  let seat = 0, i1 = 0, i2 = 0, i3 = 0, full = 0;
  for (const e of active) {
    const d = deriveEnrollment(e);
    const seatOk = seatPaidEnrollment(e) || d.paid > 0;
    if (!seatOk && !d.isFullyPaid) continue;
    if (seatOk || d.isFullyPaid) seat++;
    const n = installmentPaidCount(e);
    if (d.isFullyPaid) {
      i1++; i2++; i3++; full++;
      continue;
    }
    if (n >= 1) i1++;
    if (n >= 2) i2++;
    if (n >= 3) i3++;
  }
  return [
    { key: "seat", label: "Seat booked (confirmed)", count: seat },
    { key: "inst1", label: "≥ 1 installment paid", count: i1 },
    { key: "inst2", label: "≥ 2 installments paid", count: i2 },
    { key: "inst3", label: "≥ 3 installments paid", count: i3 },
    { key: "full", label: "Fully paid", count: full },
  ];
}

function daySeries(days: number, fill: (ymd: string) => number): SparkPoint[] {
  const out: SparkPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const ymd = istYMD(new Date(Date.now() - i * 86400000)) || "";
    if (!ymd) continue;
    out.push({ day: ymd, value: fill(ymd) });
  }
  return out;
}

function seatBookingsOnYmd(payments: Payment[], ymd: string): number {
  const rows = payments.filter(
    (p) =>
      !p.deleted_at &&
      isPaidStatus(p.status) &&
      p.item_type === "course" &&
      p.payment_kind === "seat" &&
      istYMD(p.created_at) === ymd,
  );
  return distinctRegistrations(rows);
}

function webinarStatusCounts(payments: Payment[], slug: string): WebinarRow["status"] {
  const rows = payments.filter((p) => p.item_type === "webinar" && itemKey(p) === slug.toLowerCase() && !p.deleted_at && !p.is_superseded);
  let paid = 0, abandoned = 0, failed = 0, pending = 0;
  for (const p of rows) {
    const s = (p.status || "").toUpperCase();
    if (isPaidStatus(p.status)) paid++;
    else if (s === "ABANDONED") abandoned++;
    else if (s === "FAILED") failed++;
    else if (["PENDING", "VERIFYING", "INITIATED"].includes(s)) pending++;
  }
  return { paid, abandoned, failed, pending };
}

function buildWebinarRow(w: Webinar, paidPayments: Payment[], allPayments: Payment[]): WebinarRow {
  const paidFor = paidPayments.filter((p) => p.item_type === "webinar" && itemKey(p) === w.slug.toLowerCase());
  const paid = distinctRegistrations(paidFor);
  return {
    id: w.id,
    slug: w.slug,
    title: w.title,
    datetime: w.datetime,
    registrations: paid,
    paid,
    revenue: dedupedPaidTotal(paidFor),
    conversionPct: null, // paid-only denominator — conversion vs free regs omitted to avoid false rates
    status: webinarStatusCounts(allPayments, w.slug),
  };
}

function emptyHistory(): HistorySeries {
  return {
    visitors: [],
    logins: [],
    loginUsers: [],
    webinarPaid: [],
    leads: [],
    seatBookings: [],
    webinarRevenue: [],
    courseRevenue: [],
  };
}

function emptyMetric(scope: MetricDelta["scope"] = "today"): MetricDelta {
  return metric(null, null, scope, "Loading…");
}

/** Fast first paint: pulse KPIs + ~60d history for sparklines / explorer. */
export async function getExecutivePulse(opts: {
  preset: ExecPreset;
  excludeAdmin?: boolean;
  canRevenue?: boolean;
}): Promise<ExecutivePulse> {
  const excludeAdmin = !!opts.excludeAdmin;
  const canRevenue = opts.canRevenue !== false;
  const unavailable: string[] = [];
  const bounds = resolveExecRange(opts.preset);
  const todayBounds = resolveRange("today");
  const yBounds = resolveRange("yesterday");
  const todayFromMs = new Date(todayBounds.from).getTime();
  const todayToMs = new Date(todayBounds.to).getTime();
  const yFromMs = new Date(yBounds.from).getTime();
  const yToMs = new Date(yBounds.to).getTime();
  const fromMs = new Date(bounds.from).getTime();
  const toMs = new Date(bounds.to).getTime();
  const prevFromMs = new Date(bounds.prevFrom).getTime();
  const prevToMs = new Date(bounds.prevTo).getTime();

  // ~60 calendar days of events for explorer (portal ~1 month live → covers all)
  const histFrom = new Date(Date.now() - 60 * 86400000).toISOString();
  const histTo = new Date().toISOString();

  const [payments, buyers, leads, histEvents, staffPhones] = await Promise.all([
    cachedPayments(),
    getBuyers(),
    getLeads({ includeLegacy: false }),
    fetchEvents(histFrom, histTo),
    excludeAdmin ? getStaffPhoneSet() : Promise.resolve(new Set<string>()),
  ]);

  const filterEvents = (evs: EventLite[]) =>
    excludeAdmin ? evs.filter((e) => !(e.phone && staffPhones.has(normPhone(e.phone)!))) : evs;
  const hev = filterEvents(histEvents);

  const paidIn = (from: number, to: number) =>
    payments.filter((p) => !p.deleted_at && isPaidStatus(p.status) && inRange(p.created_at, from, to));

  const webinarRev = (from: number, to: number) =>
    canRevenue ? dedupedPaidTotal(paidIn(from, to).filter((p) => p.item_type === "webinar")) : null;
  const courseRev = (from: number, to: number) =>
    canRevenue ? dedupedPaidTotal(paidIn(from, to).filter((p) => p.item_type === "course")) : null;

  const seatBookings = (from: number, to: number) =>
    distinctRegistrations(paidIn(from, to).filter((p) => p.item_type === "course" && p.payment_kind === "seat"));

  // SAME as Payments page today card
  const todayYmd = istTodayYMD();
  const ydayYmd = istYMD(new Date(Date.now() - 86400000)) || "";
  const webRegsTodayN = paidWebinarRegsOnYmd(payments, todayYmd);
  const webRegsYdayN = paidWebinarRegsOnYmd(payments, ydayYmd);

  const codesIn = (from: number, to: number) =>
    buyers.filter((b) => !b.is_staff && inRange(b.created_at, from, to)).length;
  const leadsIn = (from: number, to: number) => leads.filter((l) => inRange(l.created_at, from, to));

  const loginKey = (e: EventLite) => e.buyer_id || (e.phone ? normPhone(e.phone) : null);
  const visitorsOn = (ymd: string) => {
    const set = new Set<string>();
    for (const e of hev) {
      if (istYMD(e.occurred_at) !== ymd || !e.visitor_id) continue;
      set.add(e.visitor_id);
    }
    return set.size;
  };
  const loginUsersOn = (ymd: string) => {
    const set = new Set<string>();
    for (const e of hev) {
      if (e.event_name !== "login" || istYMD(e.occurred_at) !== ymd) continue;
      const k = loginKey(e);
      if (k) set.add(k);
    }
    return set.size;
  };
  const loginsOn = (ymd: string) => hev.filter((e) => e.event_name === "login" && istYMD(e.occurred_at) === ymd).length;

  const visitorsToday = visitorsOn(todayYmd);
  const visitorsYday = visitorsOn(ydayYmd);
  const loginUsersToday = loginUsersOn(todayYmd);
  const loginUsersYday = loginUsersOn(ydayYmd);

  const webinarByDay = buildWebinarByDay(
    payments.filter((p) => !p.deleted_at),
    "",
  );

  const history: HistorySeries = {
    visitors: daySeries(60, visitorsOn),
    logins: daySeries(60, loginsOn),
    loginUsers: daySeries(60, loginUsersOn),
    webinarPaid: daySeries(60, (ymd) => webinarByDay.get(ymd) || 0),
    leads: daySeries(60, (ymd) => leads.filter((l) => istYMD(l.created_at) === ymd).length),
    seatBookings: daySeries(60, (ymd) => seatBookingsOnYmd(payments, ymd)),
    webinarRevenue: daySeries(60, (ymd) => {
      if (!canRevenue) return 0;
      const rows = payments.filter(
        (p) => !p.deleted_at && isPaidStatus(p.status) && p.item_type === "webinar" && istYMD(p.created_at) === ymd,
      );
      return dedupedPaidTotal(rows);
    }),
    courseRevenue: daySeries(60, (ymd) => {
      if (!canRevenue) return 0;
      const rows = payments.filter(
        (p) => !p.deleted_at && isPaidStatus(p.status) && p.item_type === "course" && istYMD(p.created_at) === ymd,
      );
      return dedupedPaidTotal(rows);
    }),
  };

  unavailable.push(
    "New vs returning logged-in users requires lifetime first-login stamps — omitted rather than estimated.",
  );

  const scopePeriodUnused = opts.preset; // preset retained for history context / API
  void scopePeriodUnused;
  void fromMs;
  void toMs;
  void prevFromMs;
  void prevToMs;

  return {
    generatedAt: new Date().toISOString(),
    range: { from: bounds.from, to: bounds.to },
    prevRange: { from: bounds.prevFrom, to: bounds.prevTo },
    preset: opts.preset,
    excludeAdmin,
    canRevenue,
    pulse: {
      visitorsToday: metric(visitorsToday, visitorsYday, "today"),
      loginUsersToday: metric(loginUsersToday, loginUsersYday, "today"),
      loginCodesToday: metric(codesIn(todayFromMs, todayToMs), codesIn(yFromMs, yToMs), "today"),
      leadsToday: metric(leadsIn(todayFromMs, todayToMs).length, leadsIn(yFromMs, yToMs).length, "today"),
      webinarRegsToday: metric(webRegsTodayN, webRegsYdayN, "today"),
      seatBookingsToday: metric(seatBookings(todayFromMs, todayToMs), seatBookings(yFromMs, yToMs), "today"),
      webinarRevenue: metric(webinarRev(todayFromMs, todayToMs), webinarRev(yFromMs, yToMs), "today"),
      courseRevenue: metric(courseRev(todayFromMs, todayToMs), courseRev(yFromMs, yToMs), "today"),
    },
    history,
    unavailable,
  };
}

/** Heavier sections — loaded after pulse when the viewport approaches them. */
export async function getExecutiveBody(opts: {
  preset: ExecPreset;
  excludeAdmin?: boolean;
  canRevenue?: boolean;
}): Promise<ExecutiveBody> {
  const excludeAdmin = !!opts.excludeAdmin;
  const canRevenue = opts.canRevenue !== false;
  const unavailable: string[] = [];
  const bounds = resolveExecRange(opts.preset);
  const fromMs = new Date(bounds.from).getTime();
  const toMs = new Date(bounds.to).getTime();
  const prevFromMs = new Date(bounds.prevFrom).getTime();
  const prevToMs = new Date(bounds.prevTo).getTime();
  const todayBounds = resolveRange("today");
  const todayFromMs = new Date(todayBounds.from).getTime();
  const todayToMs = new Date(todayBounds.to).getTime();
  const yBounds = resolveRange("yesterday");
  const yFromMs = new Date(yBounds.from).getTime();
  const yToMs = new Date(yBounds.to).getTime();

  const [
    payments,
    webinars,
    webinarRegs,
    enrollments,
    courses,
    buyers,
    leads,
    attempts,
    quizzes,
    caArticles,
    caPdfs,
    overrides,
    events,
    prevEvents,
    trackingStartMs,
    staffPhones,
    smsLogs,
  ] = await Promise.all([
    cachedPayments(),
    getWebinars(),
    getAllWebinarRegistrations(),
    getAllCourseEnrollments(),
    getAllCourses(),
    getBuyers(),
    getLeads({ includeLegacy: false }),
    getAllAttempts(),
    getAllQuizzes(),
    getCaArticles(),
    getCaPdfs(),
    getAllAccessOverrides(),
    fetchEvents(bounds.from, bounds.to),
    opts.preset === "all_time" ? Promise.resolve([] as EventLite[]) : fetchEvents(bounds.prevFrom, bounds.prevTo),
    getTrackingStartMs(),
    excludeAdmin ? getStaffPhoneSet() : Promise.resolve(new Set<string>()),
    listLogs({ from: bounds.from, limit: 5000 }),
  ]);

  const filterEvents = (evs: EventLite[]) =>
    excludeAdmin ? evs.filter((e) => !(e.phone && staffPhones.has(normPhone(e.phone)!))) : evs;
  const ev = filterEvents(events);
  const pev = filterEvents(prevEvents);

  const pre: OverviewPre = { events: ev, payments, trackingStartMs, staffPhones, proofPending: 0 };
  const [overview, timeseries, prevOverview] = await Promise.all([
    getAnalyticsOverview({ from: bounds.from, to: bounds.to, excludeAdmin }, pre),
    getAnalyticsTimeseries(
      { from: bounds.from, to: bounds.to, excludeAdmin },
      { events: ev, payments, attempts, staff: staffPhones },
    ),
    opts.preset === "all_time"
      ? Promise.resolve(null)
      : getAnalyticsOverview(
          { from: bounds.prevFrom, to: bounds.prevTo, excludeAdmin },
          { events: pev, payments, trackingStartMs, staffPhones, proofPending: 0 },
        ),
  ]);

  const paidIn = (from: number, to: number) =>
    payments.filter((p) => !p.deleted_at && isPaidStatus(p.status) && inRange(p.created_at, from, to));
  const payIn = (from: number, to: number) =>
    payments.filter((p) => !p.deleted_at && inRange(p.created_at, from, to));

  const webinarRev = (from: number, to: number) =>
    canRevenue ? dedupedPaidTotal(paidIn(from, to).filter((p) => p.item_type === "webinar")) : null;
  const courseRev = (from: number, to: number) =>
    canRevenue ? dedupedPaidTotal(paidIn(from, to).filter((p) => p.item_type === "course")) : null;
  const seatBookings = (from: number, to: number) =>
    distinctRegistrations(paidIn(from, to).filter((p) => p.item_type === "course" && p.payment_kind === "seat"));
  const codesIn = (from: number, to: number) =>
    buyers.filter((b) => !b.is_staff && inRange(b.created_at, from, to)).length;
  const leadsIn = (from: number, to: number) => leads.filter((l) => inRange(l.created_at, from, to));

  const todayYmd = istTodayYMD();
  const ydayYmd = istYMD(new Date(Date.now() - 86400000)) || "";
  const webRegsTodayN = paidWebinarRegsOnYmd(payments, todayYmd);
  const webRegsYdayN = paidWebinarRegsOnYmd(payments, ydayYmd);
  const seatsTodayN = seatBookings(todayFromMs, todayToMs);
  const leadsTodayN = leadsIn(todayFromMs, todayToMs).length;
  const leadsYdayN = leadsIn(yFromMs, yToMs).length;
  const metaTodayN = leadsIn(todayFromMs, todayToMs).filter(isMetaLead).length;
  const metaYdayN = leadsIn(yFromMs, yToMs).filter(isMetaLead).length;

  const pageMap = new Map<string, { views: number; vis: Set<string>; clicks: number }>();
  for (const e of ev) {
    const path = (e.page_path || "").split("?")[0] || "/";
    if (!path || path.startsWith("/admin") || path.startsWith("/api")) continue;
    const cur = pageMap.get(path) || { views: 0, vis: new Set(), clicks: 0 };
    if (e.event_name === "page_view") {
      cur.views++;
      if (e.visitor_id) cur.vis.add(e.visitor_id);
    }
    if (e.event_name === "click_register_pay" || e.event_name === "click_enroll" || e.event_name === "announcement_click") {
      cur.clicks++;
    }
    pageMap.set(path, cur);
  }
  const prevPageViews = new Map<string, number>();
  for (const e of pev) {
    if (e.event_name !== "page_view") continue;
    const path = (e.page_path || "").split("?")[0] || "/";
    prevPageViews.set(path, (prevPageViews.get(path) || 0) + 1);
  }
  const topPages: RankedPage[] = [...pageMap.entries()]
    .map(([path, v]) => ({
      path,
      views: v.views,
      uniqueVisitors: v.vis.size,
      clicks: v.clicks,
      prevViews: prevPageViews.has(path) ? prevPageViews.get(path)! : null,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 12);

  const paidWebBySlug = new Map<string, Payment[]>();
  for (const p of payments.filter((x) => isPaidStatus(x.status) && x.item_type === "webinar" && !x.deleted_at)) {
    const k = itemKey(p);
    if (!paidWebBySlug.has(k)) paidWebBySlug.set(k, []);
    paidWebBySlug.get(k)!.push(p);
  }
  // webinarRegs kept for free-webinar awareness only — paid counts never use it
  void webinarRegs;

  const webinarRows = webinars.map((w) =>
    buildWebinarRow(w, paidWebBySlug.get(w.slug.toLowerCase()) || [], payments),
  );
  const topWebinars = [...webinarRows].sort((a, b) => b.paid - a.paid || b.revenue - a.revenue).slice(0, 8);
  const recentWebinars = [...webinarRows]
    .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())
    .slice(0, 3);

  const webPayInRange = payIn(fromMs, toMs).filter((p) => p.item_type === "webinar" && !p.is_superseded);
  const paymentFunnel = {
    paid: webPayInRange.filter((p) => isPaidStatus(p.status)).length,
    abandoned: webPayInRange.filter((p) => (p.status || "").toUpperCase() === "ABANDONED").length,
    failed: webPayInRange.filter((p) => (p.status || "").toUpperCase() === "FAILED").length,
    pending: webPayInRange.filter((p) => ["PENDING", "VERIFYING", "INITIATED"].includes((p.status || "").toUpperCase())).length,
  };

  const webinarByDay = buildWebinarByDay(
    payments.filter((p) => !p.deleted_at),
    "",
  );
  const webinarTrend = timeseries.points.map((p) => ({ day: p.day, value: webinarByDay.get(p.day) || 0 }));

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const seatAllTime = seatBookings(0, Date.now() + 86400000);
  const courseRows: CourseRow[] = courses.map((c) => {
    const enrs = enrollments.filter((e) => e.course_id === c.id && isActiveEnrollment(e));
    const seat = enrs.filter(seatPaidEnrollment).length;
    const admitted = enrs.filter((e) => deriveEnrollment(e).paid > 0).length;
    const revenue = canRevenue
      ? dedupedPaidTotal(
          payments.filter(
            (p) =>
              isPaidStatus(p.status) &&
              p.item_type === "course" &&
              !p.deleted_at &&
              (p.item_slug === c.slug || (!!p.enrollment_id && enrs.some((e) => e.id === p.enrollment_id))),
          ),
        )
      : 0;
    const sample = enrs[0];
    const progressLabel = sample
      ? deriveEnrollment(sample).isFullyPaid
        ? "Fully paid cohort"
        : `${seat} seat · ${admitted} paying`
      : "No enrollments";
    return {
      courseId: c.id,
      slug: c.slug,
      title: c.title,
      batchStart: c.batch_start || null,
      seatBookings: seat,
      confirmedAdmissions: admitted,
      revenue,
      progressLabel,
    };
  });
  const topCourses = [...courseRows].sort((a, b) => b.seatBookings - a.seatBookings || b.revenue - a.revenue).slice(0, 8);
  const recentCourses = [...courseRows]
    .sort((a, b) => new Date(b.batchStart || 0).getTime() - new Date(a.batchStart || 0).getTime())
    .slice(0, 3);

  const courseTrend = (() => {
    const byDay = new Map<string, Payment[]>();
    for (const p of paidIn(fromMs, toMs).filter((x) => x.item_type === "course")) {
      const day = istYMD(p.created_at) || "";
      if (!day) continue;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(p);
    }
    return timeseries.points.map((pt) => ({
      day: pt.day,
      value: canRevenue ? dedupedPaidTotal(byDay.get(pt.day) || []) : 0,
    }));
  })();

  const admissionFunnel = {
    stages: buildAdmissionStages(enrollments),
    byCourse: courses.slice(0, 12).map((c) => ({
      courseId: c.id,
      title: c.title,
      stages: buildAdmissionStages(enrollments.filter((e) => e.course_id === c.id)),
    })),
  };

  const now = Date.now();
  let overdueCount = 0, overdueAmount = 0;
  const aging = [
    { bucket: "1–7 days", count: 0, amount: 0 },
    { bucket: "8–15 days", count: 0, amount: 0 },
    { bucket: "16–30 days", count: 0, amount: 0 },
    { bucket: "> 30 days", count: 0, amount: 0 },
  ];
  let upcomingCount = 0, upcomingAmount = 0;
  let blockedCount = 0, graceCount = 0;
  const overrideFor = (e: CourseEnrollment): CourseAccessOverride | undefined =>
    overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);

  for (const e of enrollments) {
    if (!isActiveEnrollment(e) || e.status === "cancelled" || e.status === "transferred_out") continue;
    const col = deriveCollections(e, now);
    if (col.overdueAmount > 0) {
      overdueCount++;
      overdueAmount += col.overdueAmount;
      const d = col.daysOverdue;
      const idx = d <= 7 ? 0 : d <= 15 ? 1 : d <= 30 ? 2 : 3;
      aging[idx].count++;
      aging[idx].amount += col.overdueAmount;
    }
    if (col.nextDueDate && col.nextDueAmount > 0 && new Date(col.nextDueDate).getTime() >= now) {
      upcomingCount++;
      upcomingAmount += col.nextDueAmount;
    }
    const course = courseById.get(e.course_id);
    if (course) {
      try {
        const access = lectureAccessForCourse(course, e, overrideFor(e), false, now);
        const decision = classifyAccessAtRisk({
          enrollment: e,
          scheduleAccess: access,
          override: overrideFor(e) || null,
          now,
        });
        if (decision.onList && decision.kind === "schedule_blocked") blockedCount++;
        if (access.status === "grace") graceCount++;
      } catch {
        /* ignore */
      }
    }
  }

  const quizTodayRows = attempts.filter((a) => inRange(a.started_at, todayFromMs, todayToMs));
  const quizYdayRows = attempts.filter((a) => inRange(a.started_at, yFromMs, yToMs));
  const quizToday = quizTodayRows.length;
  const quizYday = quizYdayRows.length;
  const quizUnique = (rows: typeof attempts) => {
    const s = new Set<string>();
    for (const a of rows) {
      const k = a.user_id || a.guest_mobile || a.guest_session_id || a.id;
      if (k) s.add(String(k));
    }
    return s.size;
  };
  const quizUniqueTodayN = quizUnique(quizTodayRows);
  const quizUniqueYdayN = quizUnique(quizYdayRows);

  const quizById = new Map<string, { attempts: number; users: Set<string> }>();
  for (const a of attempts.filter((x) => inRange(x.started_at, fromMs, toMs))) {
    const cur = quizById.get(a.quiz_id) || { attempts: 0, users: new Set<string>() };
    cur.attempts++;
    const k = a.user_id || a.guest_mobile || a.guest_session_id || a.id;
    if (k) cur.users.add(String(k));
    quizById.set(a.quiz_id, cur);
  }
  const quizTitle = new Map(quizzes.map((q) => [q.id, q.title]));
  const topQuizzes = [...quizById.entries()]
    .map(([id, v]) => ({
      id,
      title: quizTitle.get(id) || id,
      attempts: v.attempts,
      uniqueStudents: v.users.size,
    }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 8);

  const caTop = [...caArticles]
    .sort((a, b) => b.views - a.views)
    .slice(0, 8)
    .map((a) => ({ slug: a.slug, title: a.title, views: a.views }));

  const resourceDownloads = [...caPdfs]
    .sort((a, b) => (b.download_count || 0) - (a.download_count || 0))
    .slice(0, 8)
    .map((r) => ({ id: r.id, title: r.title, downloads: r.download_count || 0 }));

  const resDlPeriod = ev.filter((e) => e.event_name === "resource_download_click").length;
  const resDlPrev = pev.filter((e) => e.event_name === "resource_download_click").length;

  let smsDelivered = 0, smsFailed = 0, smsPending = 0;
  const smsDay = new Map<string, number>();
  let deliveryKnown = false;
  for (const l of smsLogs) {
    const st = (l.status || "").toUpperCase();
    if (st === "DELIVERED") { smsDelivered++; deliveryKnown = true; }
    else if (st === "FAILED") smsFailed++;
    else smsPending++;
    const day = istYMD(l.created_at) || "";
    if (day) smsDay.set(day, (smsDay.get(day) || 0) + 1);
  }
  const smsSent = smsLogs.length;

  const leadTrendMap = new Map<string, number>();
  for (const l of leadsIn(fromMs, toMs)) {
    const d = istYMD(l.created_at) || "";
    if (d) leadTrendMap.set(d, (leadTrendMap.get(d) || 0) + 1);
  }
  const leadBySource = new Map<string, number>();
  for (const l of leadsIn(fromMs, toMs)) {
    const s = (l.source || "unknown").trim() || "unknown";
    leadBySource.set(s, (leadBySource.get(s) || 0) + 1);
  }

  unavailable.push(
    "New vs returning logged-in users requires lifetime first-login stamps — omitted rather than estimated.",
  );

  const scopePeriod: MetricDelta["scope"] = opts.preset === "all_time" ? "all_time" : "period";
  const loginSum = timeseries.points.reduce((a, p) => a + p.logins, 0);
  const nDays = Math.max(1, timeseries.points.length);

  return {
    generatedAt: new Date().toISOString(),
    activity: {
      visitors: metric(overview.kpis.visitors, prevOverview?.kpis.visitors ?? null, scopePeriod),
      pageViews: metric(overview.kpis.pageViews, prevOverview?.kpis.pageViews ?? null, scopePeriod),
      logins: metric(overview.kpis.logins, prevOverview?.kpis.logins ?? null, scopePeriod),
      loginUsers: metric(overview.kpis.loginUsers, prevOverview?.kpis.loginUsers ?? null, scopePeriod),
      loginCodesGenerated: metric(codesIn(fromMs, toMs), codesIn(prevFromMs, prevToMs), scopePeriod),
      visitorTrend: timeseries.points.map((p) => ({ day: p.day, value: p.visitors })),
      loginTrend: timeseries.points.map((p) => ({ day: p.day, value: p.logins })),
      loginAverages: {
        daily: Math.round((loginSum / nDays) * 10) / 10,
        weekly: Math.round((loginSum / Math.max(1, nDays / 7)) * 10) / 10,
        monthly: Math.round((loginSum / Math.max(1, nDays / 30)) * 10) / 10,
      },
      topPages,
      newVsReturningLogins: {
        newUsers: null,
        returningUsers: null,
        unavailableReason: "Lifetime first-login stamps are not queryable as a first-class field.",
      },
    },
    leads: {
      totalPeriod: metric(leadsIn(fromMs, toMs).length, leadsIn(prevFromMs, prevToMs).length, scopePeriod),
      today: metric(leadsTodayN, leadsYdayN, "today"),
      metaToday: metric(metaTodayN, metaYdayN, "today"),
      metaPeriod: metric(
        leadsIn(fromMs, toMs).filter(isMetaLead).length,
        leadsIn(prevFromMs, prevToMs).filter(isMetaLead).length,
        scopePeriod,
      ),
      trend: [...leadTrendMap.entries()].map(([day, value]) => ({ day, value })).sort((a, b) => a.day.localeCompare(b.day)),
      bySource: [...leadBySource.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    },
    webinars: {
      regsToday: metric(webRegsTodayN, webRegsYdayN, "today"),
      revenue: metric(webinarRev(fromMs, toMs), webinarRev(prevFromMs, prevToMs), scopePeriod),
      trend: webinarTrend,
      top: topWebinars,
      recent: recentWebinars,
      paymentFunnel,
    },
    courses: {
      seatBookingsToday: metric(seatsTodayN, seatBookings(yFromMs, yToMs), "today"),
      seatBookingsAllTime: metric(seatAllTime, null, "all_time"),
      revenue: metric(courseRev(fromMs, toMs), courseRev(prevFromMs, prevToMs), scopePeriod),
      trend: courseTrend,
      top: topCourses,
      recent: recentCourses,
    },
    admissionFunnel,
    collections: {
      overdueCount: metric(overdueCount, null, "all_time"),
      overdueAmount: metric(canRevenue ? overdueAmount : null, null, "all_time", canRevenue ? undefined : "Revenue permission required"),
      blockedCount: metric(blockedCount, null, "all_time"),
      graceCount: metric(graceCount, null, "all_time"),
      aging,
      upcomingDue: { count: upcomingCount, amount: canRevenue ? upcomingAmount : 0 },
    },
    engagement: {
      quizAttemptsToday: metric(quizToday, quizYday, "today"),
      quizUniqueToday: metric(quizUniqueTodayN, quizUniqueYdayN, "today"),
      quizTrend: timeseries.points.map((p) => ({ day: p.day, value: p.quizAttempts })),
      topQuizzes,
      caTop,
      resourceDownloads,
      resourceDownloadEvents: metric(resDlPeriod, resDlPrev, scopePeriod),
    },
    sms: {
      sent: smsSent,
      delivered: deliveryKnown ? smsDelivered : null,
      failed: smsFailed,
      pending: smsPending,
      deliveryRate: deliveryKnown && smsSent ? Math.round((smsDelivered / smsSent) * 1000) / 10 : null,
      failureRate: smsSent ? Math.round((smsFailed / smsSent) * 1000) / 10 : null,
      deliveryKnown,
      trend: [...smsDay.entries()].map(([day, value]) => ({ day, value })).sort((a, b) => a.day.localeCompare(b.day)),
    },
    unavailable,
  };
}

/** Full snapshot (tests / legacy). Prefer pulse + body for the UI. */
export async function getExecutiveOverview(opts: {
  preset: ExecPreset;
  from?: string | null;
  to?: string | null;
  excludeAdmin?: boolean;
  canRevenue?: boolean;
}): Promise<ExecutiveOverview> {
  const [pulse, body] = await Promise.all([
    getExecutivePulse(opts),
    getExecutiveBody(opts),
  ]);
  return { ...pulse, ...body, unavailable: [...new Set([...pulse.unavailable, ...body.unavailable])] };
}

export { emptyHistory, emptyMetric };
