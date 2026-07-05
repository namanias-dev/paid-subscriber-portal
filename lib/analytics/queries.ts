/**
 * Read-side analytics queries for the admin command center.
 *
 * RECONCILIATION RULE: all money/seat numbers come from the `payments` table via
 * lib/paymentsAgg (the SAME dedupe the Payments tab uses), never from the event
 * log — so the dashboard always ties out to Payments. Events power behaviour,
 * funnel and source attribution only.
 */
import { getSupabaseAdmin } from "../supabase";
import { getPayments, getAdminAccounts, getAllAttempts, getAllQuizzes, getWebinars, getAllWebinarRegistrations } from "../dataProvider";
import { isPaidStatus, dedupePaidRows, dedupedPaidTotal, distinctRegistrations, itemKey } from "../paymentsAgg";
import { normPhone } from "../phone";
import { istInputToISO } from "../dates";
import { NON_ATTRIBUTABLE_SOURCES, sourceLabel } from "./metrics";
import { getMetaSpend } from "./metaInsights";
import type { Payment, QuizAttempt, Webinar, WebinarRegistration } from "../types";

/**
 * Bucket for records created BEFORE attribution tracking existed (NULL source).
 * Kept distinct from the real "direct" channel and shown muted in the UI — it is
 * "pre-tracking / unknown", not an acquisition source. Its revenue is ALWAYS
 * included so by-source totals reconcile with the Payments tab.
 */
export const UNTRACKED = "untracked";

export interface EventLite {
  event_id: string;
  event_name: string;
  visitor_id: string | null;
  buyer_id: string | null;
  phone: string | null;
  session_id: string | null;
  occurred_at: string;
  page_path: string | null;
  device: { type?: string; os?: string; browser?: string } | null;
  attribution: AttrJSON | null;
  props: Record<string, unknown> | null;
}

type AttrTouch = { source?: string; medium?: string; campaign?: string; content?: string; landing_path?: string };
type AttrJSON = { first_touch?: AttrTouch; last_touch?: AttrTouch };

export function sourceOfEvent(e: EventLite): string {
  // A captured attribution with no UTM/referrer is genuinely "direct"; a totally
  // missing attribution object means we never tracked it -> "untracked".
  const s = e.attribution?.first_touch?.source || e.attribution?.last_touch?.source;
  return s || UNTRACKED;
}

export function sourceOfPayment(p: Payment): string {
  // NULL = created before tracking -> "untracked" (never silently "direct").
  return p.attribution_source ? p.attribution_source.toLowerCase() : UNTRACKED;
}

const EVENT_FETCH_CAP = 50000;

export async function fetchEvents(fromISO: string, toISO: string): Promise<EventLite[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("analytics_events")
    .select("event_id,event_name,visitor_id,buyer_id,phone,session_id,occurred_at,page_path,device,attribution,props")
    .gte("occurred_at", fromISO)
    .lte("occurred_at", toISO)
    .eq("is_bot", false)
    .order("occurred_at", { ascending: false })
    .limit(EVENT_FETCH_CAP);
  return (data as EventLite[]) || [];
}

function dayKeyIST(iso: string): string {
  // IST day bucket (UTC+5:30) without pulling a tz lib.
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export interface DashboardSummary {
  range: { from: string; to: string };
  kpis: {
    visitors: number;
    sessions: number;
    pageViews: number;
    registrations: number;
    paidCount: number;
    revenue: number;
    abandoned: number;
  };
  funnel: { label: string; value: number }[];
  bySource: { source: string; visitors: number; registrations: number; paid: number; revenue: number; conversion: number }[];
  daily: { day: string; visitors: number; registrations: number; paid: number; revenue: number }[];
  sources: string[];
}

export async function getDashboardSummary(opts: { from: string; to: string; source?: string | null; campaign?: string | null }): Promise<DashboardSummary> {
  const fromISO = new Date(opts.from).toISOString();
  const toISO = new Date(opts.to).toISOString();
  const wantSource = (opts.source || "").toLowerCase();
  const wantCampaign = (opts.campaign || "").toLowerCase();

  const allEvents = await fetchEvents(fromISO, toISO);
  const events = allEvents.filter((e) => {
    if (wantSource && wantSource !== "all" && sourceOfEvent(e) !== wantSource) return false;
    if (wantCampaign) {
      const c = (e.attribution?.first_touch?.campaign || e.attribution?.last_touch?.campaign || "").toLowerCase();
      if (c !== wantCampaign) return false;
    }
    return true;
  });

  // Payments in range (authoritative money) — reuse paymentsAgg dedupe.
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  const allPayments = await getPayments();
  let paidRowsRaw = allPayments.filter((p) => {
    const t = new Date(p.created_at).getTime();
    return isPaidStatus(p.status) && t >= fromMs && t <= toMs;
  });
  if (wantSource && wantSource !== "all") paidRowsRaw = paidRowsRaw.filter((p) => sourceOfPayment(p) === wantSource);
  if (wantCampaign) paidRowsRaw = paidRowsRaw.filter((p) => (p.attribution_campaign || "").toLowerCase() === wantCampaign);

  // Collapse retry-duplicate paid rows FIRST, then bucket by source — so the sum
  // of every source bucket (incl. "untracked") === dedupedPaidTotal exactly, and
  // ties out to the Payments tab. Money/seat numbers all derive from this set.
  const paidRows = dedupePaidRows(paidRowsRaw);
  const revenue = dedupedPaidTotal(paidRowsRaw); // == sum(paidRows.amount)
  const paidCount = distinctRegistrations(paidRowsRaw);

  const visitorSet = new Set<string>();
  let sessions = 0, pageViews = 0, registrations = 0, webinarViews = 0, clicks = 0, initiated = 0, paidEvents = 0, abandoned = 0;
  for (const e of events) {
    if (e.visitor_id) visitorSet.add(e.visitor_id);
    switch (e.event_name) {
      case "session_start": sessions++; break;
      case "page_view": pageViews++; break;
      case "registration_created": registrations++; break;
      case "webinar_view": webinarViews++; break;
      case "click_register_pay":
      case "click_enroll": clicks++; break;
      case "payment_initiated": initiated++; break;
      case "payment_paid": paidEvents++; break;
      case "payment_abandoned": abandoned++; break;
    }
  }

  // Per-source acquisition: visitors (distinct) from events, paid/revenue from payments.
  const srcVisitors = new Map<string, Set<string>>();
  const srcRegs = new Map<string, number>();
  for (const e of events) {
    const s = sourceOfEvent(e);
    if (e.visitor_id) {
      if (!srcVisitors.has(s)) srcVisitors.set(s, new Set());
      srcVisitors.get(s)!.add(e.visitor_id);
    }
    if (e.event_name === "registration_created") srcRegs.set(s, (srcRegs.get(s) || 0) + 1);
  }
  const srcPaid = new Map<string, { count: number; revenue: number }>();
  for (const p of paidRows) {
    const s = sourceOfPayment(p);
    const cur = srcPaid.get(s) || { count: 0, revenue: 0 };
    cur.count += 1; cur.revenue += p.amount;
    srcPaid.set(s, cur);
  }
  const sourceKeys = new Set<string>([...srcVisitors.keys(), ...srcPaid.keys(), ...srcRegs.keys()]);
  const bySource = [...sourceKeys].map((s) => {
    const visitors = srcVisitors.get(s)?.size || 0;
    const paid = srcPaid.get(s)?.count || 0;
    return {
      source: s,
      visitors,
      registrations: srcRegs.get(s) || 0,
      paid,
      revenue: srcPaid.get(s)?.revenue || 0,
      conversion: visitors > 0 ? Math.round((paid / visitors) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.revenue - a.revenue || b.visitors - a.visitors);

  // Daily series (IST buckets).
  const daily = new Map<string, { visitors: Set<string>; registrations: number; paid: number; revenue: number }>();
  const ensureDay = (k: string) => { if (!daily.has(k)) daily.set(k, { visitors: new Set(), registrations: 0, paid: 0, revenue: 0 }); return daily.get(k)!; };
  for (const e of events) {
    const k = dayKeyIST(e.occurred_at);
    const d = ensureDay(k);
    if (e.visitor_id) d.visitors.add(e.visitor_id);
    if (e.event_name === "registration_created") d.registrations++;
  }
  for (const p of paidRows) {
    const k = dayKeyIST(p.created_at);
    const d = ensureDay(k);
    d.paid++; d.revenue += p.amount;
  }
  const dailyArr = [...daily.entries()]
    .map(([day, v]) => ({ day, visitors: v.visitors.size, registrations: v.registrations, paid: v.paid, revenue: v.revenue }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    range: { from: fromISO, to: toISO },
    kpis: { visitors: visitorSet.size, sessions, pageViews, registrations, paidCount, revenue, abandoned },
    funnel: [
      { label: "Webinar views", value: webinarViews },
      { label: "Clicked pay", value: clicks },
      { label: "Payment initiated", value: initiated },
      { label: "Paid", value: paidEvents },
    ],
    bySource,
    daily: dailyArr,
    sources: [...sourceKeys].sort(),
  };
}

// ----------------------------- Per-student journey -----------------------------

export interface JourneyResult {
  phone: string | null;
  buyer: { id: string; name: string | null; login_code?: string | null } | null;
  attribution: { source: string | null; campaign: string | null; landing_path: string | null; first_seen_at: string | null } | null;
  flags: { paid: boolean; loggedInSincePaid: boolean; clickedZoom: boolean; registered: boolean };
  events: EventLite[];
}

export async function getJourney(phoneRaw: string): Promise<JourneyResult> {
  const db = getSupabaseAdmin();
  const phone = normPhone(phoneRaw);
  if (!db || !phone) return { phone, buyer: null, attribution: null, flags: { paid: false, loggedInSincePaid: false, clickedZoom: false, registered: false }, events: [] };

  const { data: buyerRow } = await db
    .from("buyers")
    .select("id,name,login_code,first_touch,last_touch,attribution_source,attribution_campaign")
    .eq("phone", phone)
    .maybeSingle();

  let q = db
    .from("analytics_events")
    .select("event_id,event_name,visitor_id,buyer_id,phone,occurred_at,page_path,attribution,props")
    .order("occurred_at", { ascending: false })
    .limit(500);
  q = buyerRow?.id ? q.or(`phone.eq.${phone},buyer_id.eq.${buyerRow.id}`) : q.eq("phone", phone);
  const { data: evRows } = await q;
  const events = (evRows as EventLite[]) || [];

  const ft = (buyerRow?.first_touch as { source?: string; campaign?: string; landing_path?: string; first_seen_at?: string } | null) || null;
  const lastPaidAt = events.filter((e) => e.event_name === "payment_paid").map((e) => e.occurred_at).sort().pop() || null;
  const loginAfterPaid = !!lastPaidAt && events.some((e) => e.event_name === "login" && e.occurred_at > lastPaidAt);

  return {
    phone,
    buyer: buyerRow ? { id: buyerRow.id, name: buyerRow.name, login_code: buyerRow.login_code } : null,
    attribution: {
      source: (buyerRow?.attribution_source as string) || ft?.source || null,
      campaign: (buyerRow?.attribution_campaign as string) || ft?.campaign || null,
      landing_path: ft?.landing_path || null,
      first_seen_at: ft?.first_seen_at || null,
    },
    flags: {
      paid: !!lastPaidAt,
      loggedInSincePaid: loginAfterPaid,
      clickedZoom: events.some((e) => e.event_name === "zoom_link_clicked"),
      registered: events.some((e) => e.event_name === "registration_created"),
    },
    events,
  };
}

// ----------------------------- Re-engagement segments -----------------------------

export type SegmentKey = "paid_not_logged_in" | "payment_pending_or_abandoned" | "clicked_pay_not_paid" | "paid_not_clicked_zoom" | "payment_verifying" | "registered_no_quiz";

export interface SegmentRow { phone: string; name: string | null; detail: string; source: string | null; lastAt: string | null; buyerId: string | null }

export async function getSegment(key: SegmentKey): Promise<SegmentRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];

  const payments = await getPayments();
  const byPhone = new Map<string, Payment[]>();
  for (const p of payments) {
    const ph = normPhone(p.phone);
    if (!ph) continue;
    if (!byPhone.has(ph)) byPhone.set(ph, []);
    byPhone.get(ph)!.push(p);
  }

  // Latest paid-status item set per phone.
  const paidItems = new Map<string, Set<string>>();   // phone -> itemKeys paid
  const initiatedItems = new Map<string, Set<string>>(); // phone -> itemKeys ever attempted
  const webinarPaid = new Map<string, Set<string>>();  // phone -> webinar itemKeys paid
  for (const [ph, rows] of byPhone) {
    for (const p of rows) {
      const k = itemKey(p);
      if (!initiatedItems.has(ph)) initiatedItems.set(ph, new Set());
      initiatedItems.get(ph)!.add(k);
      if (isPaidStatus(p.status)) {
        if (!paidItems.has(ph)) paidItems.set(ph, new Set());
        paidItems.get(ph)!.add(k);
        if (p.item_type === "webinar") {
          if (!webinarPaid.has(ph)) webinarPaid.set(ph, new Set());
          webinarPaid.get(ph)!.add(k);
        }
      }
    }
  }

  const nameOf = (ph: string) => byPhone.get(ph)?.find((p) => p.student_name)?.student_name || null;
  const sourceOf = (ph: string) => byPhone.get(ph)?.find((p) => p.attribution_source)?.attribution_source || null;
  const latestOf = (ph: string) => byPhone.get(ph)?.map((p) => p.created_at).sort().pop() || null;

  // Helper: phones with a given event (e.g. login, zoom_link_clicked).
  async function phonesWithEvent(eventName: string): Promise<Set<string>> {
    const set = new Set<string>();
    const { data } = await db!
      .from("analytics_events")
      .select("phone")
      .eq("event_name", eventName)
      .not("phone", "is", null)
      .limit(20000);
    for (const r of (data as { phone: string }[]) || []) { const ph = normPhone(r.phone); if (ph) set.add(ph); }
    return set;
  }

  if (key === "paid_not_logged_in") {
    const loggedIn = await phonesWithEvent("login");
    const rows: SegmentRow[] = [];
    for (const ph of paidItems.keys()) {
      if (!loggedIn.has(ph)) rows.push({ phone: ph, name: nameOf(ph), detail: "Paid — never logged in", source: sourceOf(ph), lastAt: latestOf(ph), buyerId: null });
    }
    return rows.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
  }

  if (key === "paid_not_clicked_zoom") {
    // Per (phone, webinar) accuracy: a phone leaves this segment for a given
    // webinar the moment ANY real zoom_link_clicked is recorded for that
    // phone+webinar_slug. A phone stays listed only while it has >=1 paid webinar
    // it has never joined.
    const zoomSet = new Set<string>(); // `${phone}|${slug}`
    const { data } = await db
      .from("analytics_events")
      .select("phone,props")
      .eq("event_name", "zoom_link_clicked")
      .not("phone", "is", null)
      .limit(20000);
    for (const r of (data as { phone: string; props: { webinar_slug?: string } | null }[]) || []) {
      const ph = normPhone(r.phone);
      const slug = String(r.props?.webinar_slug || "").toLowerCase();
      if (ph) zoomSet.add(`${ph}|${slug}`);
    }
    const rows: SegmentRow[] = [];
    for (const [ph, slugs] of webinarPaid) {
      const notJoined = [...slugs].filter((k) => !zoomSet.has(`${ph}|${k}`));
      if (notJoined.length) rows.push({ phone: ph, name: nameOf(ph), detail: `${notJoined.length} paid webinar(s) — no Zoom click`, source: sourceOf(ph), lastAt: latestOf(ph), buyerId: null });
    }
    return rows.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
  }

  if (key === "payment_verifying") {
    const rows: SegmentRow[] = [];
    for (const [ph, list] of byPhone) {
      const latest = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      if ((latest?.status || "").toUpperCase() === "VERIFYING" && !isPaidStatus(latest.status)) {
        rows.push({ phone: ph, name: nameOf(ph), detail: `Verifying — ₹${latest.amount?.toLocaleString("en-IN") || 0}`, source: sourceOf(ph), lastAt: latest.created_at, buyerId: null });
      }
    }
    return rows.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
  }

  if (key === "registered_no_quiz") {
    // Registered leads (have a payment row or webinar registration) who have NEVER
    // attempted a quiz — strong prompt to nudge with a free quiz.
    const attempts = await getAllAttempts();
    const quizPhones = new Set<string>();
    const userIds = new Set<string>();
    for (const a of attempts) { const ph = normPhone(a.guest_mobile); if (ph) quizPhones.add(ph); if (a.user_id) userIds.add(a.user_id); }
    if (userIds.size) {
      try {
        const { data } = await db.from("students").select("id,phone").in("id", [...userIds]);
        for (const r of (data as { id: string; phone: string | null }[]) || []) { const ph = normPhone(r.phone); if (ph) quizPhones.add(ph); }
      } catch { /* ignore */ }
    }
    const rows: SegmentRow[] = [];
    for (const ph of byPhone.keys()) {
      if (!quizPhones.has(ph)) rows.push({ phone: ph, name: nameOf(ph), detail: "Registered — never attempted a quiz", source: sourceOf(ph), lastAt: latestOf(ph), buyerId: null });
    }
    return rows.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
  }

  if (key === "payment_pending_or_abandoned") {
    const rows: SegmentRow[] = [];
    for (const [ph, list] of byPhone) {
      const latest = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      const s = (latest?.status || "").toUpperCase();
      if (["PENDING", "VERIFYING", "ABANDONED", "FAILED"].includes(s) && !isPaidStatus(latest.status)) {
        rows.push({ phone: ph, name: nameOf(ph), detail: `Latest: ${s}`, source: sourceOf(ph), lastAt: latest.created_at, buyerId: null });
      }
    }
    return rows.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
  }

  // clicked_pay_not_paid: attempted an item (has a payment row) but never PAID it.
  const rows: SegmentRow[] = [];
  for (const [ph, items] of initiatedItems) {
    const paid = paidItems.get(ph) || new Set<string>();
    const unpaid = [...items].filter((k) => !paid.has(k));
    if (unpaid.length) rows.push({ phone: ph, name: nameOf(ph), detail: `${unpaid.length} item(s) clicked, not paid`, source: sourceOf(ph), lastAt: latestOf(ph), buyerId: null });
  }
  return rows.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
}

// ============================================================================
// PHASE 1 — ACCURACY FOUNDATION
// A single, documented definition for every metric. Money/people come from the
// payments table (authoritative, works for pre-tracking data too); behaviour and
// visitor attribution come from analytics_events. Conversions are only shown when
// the denominator is valid — otherwise N/A (never an impossible %).
// ============================================================================

const IST_MS = 5.5 * 3600 * 1000;

/** UTC instant of IST-midnight for the day containing `d`. */
function istStartOfDay(d: Date): Date {
  const shifted = d.getTime() + IST_MS;
  const dayStart = Math.floor(shifted / 86400000) * 86400000;
  return new Date(dayStart - IST_MS);
}

export type RangePreset = "today" | "yesterday" | "7d" | "30d" | "this_month" | "custom";

/** Resolve a preset (or custom from/to IST dates) into UTC ISO bounds. */
export function resolveRange(preset: RangePreset, fromStr?: string | null, toStr?: string | null): { from: string; to: string } {
  const now = new Date();
  if (preset === "custom" && fromStr && toStr) {
    return { from: istInputToISO(`${fromStr}T00:00`), to: istInputToISO(`${toStr}T23:59`) };
  }
  if (preset === "today") return { from: istStartOfDay(now).toISOString(), to: now.toISOString() };
  if (preset === "yesterday") {
    const todayStart = istStartOfDay(now);
    const yStart = new Date(todayStart.getTime() - 86400000);
    return { from: yStart.toISOString(), to: todayStart.toISOString() };
  }
  if (preset === "this_month") {
    const shifted = new Date(now.getTime() + IST_MS);
    const first = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - IST_MS);
    return { from: first.toISOString(), to: now.toISOString() };
  }
  const days = preset === "7d" ? 7 : 30;
  return { from: new Date(now.getTime() - days * 86400000).toISOString(), to: now.toISOString() };
}

/** Earliest tracked event time (UTC ms) — anything paid before this is "pre-tracking". */
export async function getTrackingStartMs(): Promise<number | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db
    .from("analytics_events")
    .select("occurred_at")
    .order("occurred_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const t = (data as { occurred_at?: string } | null)?.occurred_at;
  return t ? new Date(t).getTime() : null;
}

/** Internal staff phones (admin_users) — used by the "Exclude admin traffic" toggle. */
export async function getStaffPhoneSet(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const accounts = await getAdminAccounts();
    for (const a of accounts) {
      const ph = normPhone((a as { phone?: string | null }).phone ?? null);
      if (ph) set.add(ph);
    }
  } catch { /* best-effort */ }
  return set;
}

/**
 * Classify a payment into a source bucket. NEVER silently calls a no-source row
 * "direct": offline/admin rows are "admin"; rows made before tracking are
 * "pre_tracking"; everything else with no source is "untracked".
 */
export function classifyPaymentSource(p: Payment, trackingStartMs: number | null): string {
  const gw = (p.gateway || "").toLowerCase();
  if (gw === "offline" || gw === "admin" || gw === "manual") return "admin";
  if (p.attribution_source) return p.attribution_source.toLowerCase();
  const t = new Date(p.created_at).getTime();
  if (trackingStartMs && t < trackingStartMs) return "pre_tracking";
  return "untracked";
}

function pct(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 1000) / 10;
}

export interface AnalyticsOverview {
  range: { from: string; to: string };
  trackingStartISO: string | null;
  excludeAdmin: boolean;
  kpis: {
    visitors: number;
    sessions: number;
    pageViews: number;
    logins: number;
    loginUsers: number;
    registrations: number;
    paymentInitiated: number;
    paidStudents: number;
    paidTransactions: number;
    revenue: number;
    abandoned: number;
    proofPending: number;
    verifyingAmount: number;
  };
  conversions: {
    visitorToPaid: number | null;
    registrationToPaid: number | null;
    paymentToPaid: number | null;
    avgRevenuePerStudent: number | null;
  };
}

/**
 * Pre-loaded raw inputs for the overview aggregation. When a caller (e.g. the CEO
 * Overview) already holds these — because it composes several analytics functions
 * for one request — it passes them in so we DON'T re-fetch the same events/payments
 * per function. The compute below is byte-identical whether the data is injected or
 * self-loaded, so numbers never drift.
 */
export interface OverviewPre {
  events: EventLite[];
  payments: Payment[];
  trackingStartMs: number | null;
  staffPhones: Set<string>;
  proofPending: number;
}

export async function getAnalyticsOverview(opts: { from: string; to: string; excludeAdmin?: boolean }, pre?: OverviewPre): Promise<AnalyticsOverview> {
  const fromISO = new Date(opts.from).toISOString();
  const toISO = new Date(opts.to).toISOString();
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  const excludeAdmin = !!opts.excludeAdmin;

  let allEvents: EventLite[], allPayments: Payment[], trackingStartMs: number | null, staffPhones: Set<string>, proofPending: number;
  if (pre) {
    ({ events: allEvents, payments: allPayments, trackingStartMs, staffPhones, proofPending } = pre);
  } else {
    [allEvents, allPayments, trackingStartMs, staffPhones, proofPending] = await Promise.all([
      fetchEvents(fromISO, toISO),
      getPayments(),
      getTrackingStartMs(),
      excludeAdmin ? getStaffPhoneSet() : Promise.resolve(new Set<string>()),
      countSubmittedProofs(),
    ]);
  }

  const events = excludeAdmin ? allEvents.filter((e) => !(e.phone && staffPhones.has(normPhone(e.phone)!))) : allEvents;

  // Behaviour metrics (events).
  const visitorSet = new Set<string>();
  const sessionSet = new Set<string>();
  const loginUserSet = new Set<string>();
  let pageViews = 0, sessionStarts = 0, logins = 0, registrations = 0;
  for (const e of events) {
    if (e.visitor_id) visitorSet.add(e.visitor_id);
    if (e.session_id) sessionSet.add(e.session_id);
    switch (e.event_name) {
      case "page_view": pageViews++; break;
      case "session_start": sessionStarts++; break;
      case "login": logins++; { const u = e.buyer_id || (e.phone ? normPhone(e.phone) : null); if (u) loginUserSet.add(u); } break;
      case "registration_created": registrations++; break;
    }
  }

  // Payment metrics (authoritative — work even before event tracking existed).
  const inRange = (p: Payment) => { const t = new Date(p.created_at).getTime(); return t >= fromMs && t <= toMs; };
  let payments = allPayments.filter((p) => !p.deleted_at && inRange(p));
  if (excludeAdmin) payments = payments.filter((p) => !(p.phone && staffPhones.has(normPhone(p.phone)!)));

  const paymentInitiated = payments.length;
  const abandoned = payments.filter((p) => (p.status || "").toUpperCase() === "ABANDONED").length;
  const verifyingAmount = payments.filter((p) => (p.status || "").toUpperCase() === "VERIFYING").reduce((a, p) => a + (p.amount || 0), 0);

  const paidRowsRaw = payments.filter((p) => isPaidStatus(p.status));
  const paidRows = dedupePaidRows(paidRowsRaw);
  const revenue = dedupedPaidTotal(paidRowsRaw);
  const paidTransactions = paidRows.length;
  const paidStudentSet = new Set<string>();
  for (const p of paidRows) { const ph = normPhone(p.phone); if (ph) paidStudentSet.add(ph); }
  const paidStudents = paidStudentSet.size;

  // Tracked paid students = those attributed to a REAL acquisition source, so the
  // global Visitor→Paid denominator (visitors) and numerator come from the same
  // tracked world. Pre-tracking/untracked/admin payers are excluded here (shown
  // separately in the source table with N/A conversion).
  const trackedPaidStudentSet = new Set<string>();
  for (const p of paidRows) {
    const src = classifyPaymentSource(p, trackingStartMs);
    if (!NON_ATTRIBUTABLE_SOURCES.has(src)) { const ph = normPhone(p.phone); if (ph) trackedPaidStudentSet.add(ph); }
  }

  return {
    range: { from: fromISO, to: toISO },
    trackingStartISO: trackingStartMs ? new Date(trackingStartMs).toISOString() : null,
    excludeAdmin,
    kpis: {
      visitors: visitorSet.size,
      sessions: sessionSet.size || sessionStarts,
      pageViews,
      logins,
      loginUsers: loginUserSet.size,
      registrations,
      paymentInitiated,
      paidStudents,
      paidTransactions,
      revenue,
      abandoned,
      proofPending,
      verifyingAmount,
    },
    conversions: {
      visitorToPaid: visitorSet.size > 0 ? pct(trackedPaidStudentSet.size, visitorSet.size) : null,
      registrationToPaid: registrations > 0 ? pct(paidStudents, registrations) : null,
      paymentToPaid: paymentInitiated > 0 ? pct(paidTransactions, paymentInitiated) : null,
      avgRevenuePerStudent: paidStudents > 0 ? Math.round(revenue / paidStudents) : null,
    },
  };
}

export async function countSubmittedProofs(): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const { count } = await db.from("payment_proofs").select("id", { count: "exact", head: true }).eq("status", "submitted");
  return count || 0;
}

export interface SourceRow {
  source: string;
  label: string;
  isSpecial: boolean;
  visitors: number;
  sessions: number;
  registrations: number;
  paymentInitiated: number;
  paidStudents: number;
  paidTransactions: number;
  revenue: number;
  visitorToPaid: number | null;
  registrationToPaid: number | null;
  paymentToPaid: number | null;
  avgRevenuePerStudent: number | null;
}

export interface SourcesResult {
  range: { from: string; to: string };
  trackingStartISO: string | null;
  excludeAdmin: boolean;
  rows: SourceRow[];
  totals: SourceRow;
}

export async function getAnalyticsSources(opts: { from: string; to: string; excludeAdmin?: boolean }): Promise<SourcesResult> {
  const fromISO = new Date(opts.from).toISOString();
  const toISO = new Date(opts.to).toISOString();
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  const excludeAdmin = !!opts.excludeAdmin;

  const [allEvents, allPayments, trackingStartMs, staffPhones] = await Promise.all([
    fetchEvents(fromISO, toISO),
    getPayments(),
    getTrackingStartMs(),
    excludeAdmin ? getStaffPhoneSet() : Promise.resolve(new Set<string>()),
  ]);
  const events = excludeAdmin ? allEvents.filter((e) => !(e.phone && staffPhones.has(normPhone(e.phone)!))) : allEvents;

  // Event-side per source: visitors, sessions, registrations.
  const srcVisitors = new Map<string, Set<string>>();
  const srcSessions = new Map<string, Set<string>>();
  const srcRegs = new Map<string, number>();
  for (const e of events) {
    const s = sourceOfEvent(e);
    if (e.visitor_id) { (srcVisitors.get(s) || srcVisitors.set(s, new Set()).get(s)!).add(e.visitor_id); }
    if (e.session_id) { (srcSessions.get(s) || srcSessions.set(s, new Set()).get(s)!).add(e.session_id); }
    if (e.event_name === "registration_created") srcRegs.set(s, (srcRegs.get(s) || 0) + 1);
  }

  // Payment-side per source: initiated, paid students, paid transactions, revenue.
  const inRange = (p: Payment) => { const t = new Date(p.created_at).getTime(); return t >= fromMs && t <= toMs; };
  let payments = allPayments.filter((p) => !p.deleted_at && inRange(p));
  if (excludeAdmin) payments = payments.filter((p) => !(p.phone && staffPhones.has(normPhone(p.phone)!)));

  const srcInitiated = new Map<string, number>();
  const srcPaidRowsRaw = new Map<string, Payment[]>();
  for (const p of payments) {
    const s = classifyPaymentSource(p, trackingStartMs);
    srcInitiated.set(s, (srcInitiated.get(s) || 0) + 1);
    if (isPaidStatus(p.status)) (srcPaidRowsRaw.get(s) || srcPaidRowsRaw.set(s, []).get(s)!).push(p);
  }

  const keys = new Set<string>([...srcVisitors.keys(), ...srcSessions.keys(), ...srcRegs.keys(), ...srcInitiated.keys(), ...srcPaidRowsRaw.keys()]);

  function buildRow(source: string, opts2: { visitors: number; sessions: number; registrations: number; initiated: number; paidRaw: Payment[] }): SourceRow {
    const isSpecial = NON_ATTRIBUTABLE_SOURCES.has(source);
    const paidRows = dedupePaidRows(opts2.paidRaw);
    const revenue = dedupedPaidTotal(opts2.paidRaw);
    const paidStudentSet = new Set<string>();
    for (const p of paidRows) { const ph = normPhone(p.phone); if (ph) paidStudentSet.add(ph); }
    const paidStudents = paidStudentSet.size;
    const paidTransactions = paidRows.length;
    return {
      source,
      label: sourceLabel(source),
      isSpecial,
      visitors: opts2.visitors,
      sessions: opts2.sessions,
      registrations: opts2.registrations,
      paymentInitiated: opts2.initiated,
      paidStudents,
      paidTransactions,
      revenue,
      // Visitor→Paid only when this is a real source WITH tracked visitors.
      visitorToPaid: !isSpecial && opts2.visitors > 0 ? pct(paidStudents, opts2.visitors) : null,
      registrationToPaid: opts2.registrations > 0 ? pct(paidStudents, opts2.registrations) : null,
      paymentToPaid: opts2.initiated > 0 ? pct(paidTransactions, opts2.initiated) : null,
      avgRevenuePerStudent: paidStudents > 0 ? Math.round(revenue / paidStudents) : null,
    };
  }

  const rows = [...keys].map((s) => buildRow(s, {
    visitors: srcVisitors.get(s)?.size || 0,
    sessions: srcSessions.get(s)?.size || 0,
    registrations: srcRegs.get(s) || 0,
    initiated: srcInitiated.get(s) || 0,
    paidRaw: srcPaidRowsRaw.get(s) || [],
  }));

  // Real sources first (by revenue, then visitors); special buckets always last.
  rows.sort((a, b) => {
    if (a.isSpecial !== b.isSpecial) return a.isSpecial ? 1 : -1;
    return b.revenue - a.revenue || b.visitors - a.visitors;
  });

  const allPaidRaw = [...srcPaidRowsRaw.values()].flat();
  const totals = buildRow("__total__", {
    visitors: new Set(events.filter((e) => e.visitor_id).map((e) => e.visitor_id!)).size,
    sessions: new Set(events.filter((e) => e.session_id).map((e) => e.session_id!)).size,
    registrations: [...srcRegs.values()].reduce((a, b) => a + b, 0),
    initiated: payments.length,
    paidRaw: allPaidRaw,
  });
  totals.label = "Total";
  totals.isSpecial = false;
  // Totals conversion uses overall visitors but spans tracked+untracked payers, so
  // leave Visitor→Paid as N/A to avoid an apples-to-oranges %.
  totals.visitorToPaid = null;

  return {
    range: { from: fromISO, to: toISO },
    trackingStartISO: trackingStartMs ? new Date(trackingStartMs).toISOString() : null,
    excludeAdmin,
    rows,
    totals,
  };
}

// ============================================================================
// PHASE 2 — POWER
// Reuses the Phase-1 definitions, IST date ranges and the exclude-admin rule.
// ONLY sections backed by real tracked data are computed; anything untracked is
// surfaced as an explicit "not tracked yet" note rather than fabricated.
// ============================================================================

const QUIZ_FINISHED: ReadonlySet<string> = new Set(["SUBMITTED", "AUTO_SUBMITTED"]);

function quizTakerKey(a: QuizAttempt): string | null {
  if (a.user_id) return `u:${a.user_id}`;
  const ph = normPhone(a.guest_mobile);
  return ph ? `p:${ph}` : null;
}

async function fetchAttemptsInRange(fromMs: number, toMs: number): Promise<QuizAttempt[]> {
  const all = await getAllAttempts();
  return all.filter((a) => { const t = new Date(a.started_at).getTime(); return t >= fromMs && t <= toMs; });
}

/** All distinct phones that ever emitted a given event (all-time). Best-effort. */
async function phonesWithEventAllTime(eventName: string): Promise<Set<string>> {
  const db = getSupabaseAdmin();
  const set = new Set<string>();
  if (!db) return set;
  const { data } = await db.from("analytics_events").select("phone").eq("event_name", eventName).not("phone", "is", null).limit(20000);
  for (const r of (data as { phone: string }[]) || []) { const ph = normPhone(r.phone); if (ph) set.add(ph); }
  return set;
}

/** Generate IST day keys (YYYY-MM-DD) covering [from,to] inclusive. */
function genDaysIST(fromISO: string, toISO: string): string[] {
  const days: string[] = [];
  let cur = istStartOfDay(new Date(fromISO)).getTime();
  const end = new Date(toISO).getTime();
  let guard = 0;
  while (cur <= end && guard++ < 800) { days.push(dayKeyIST(new Date(cur).toISOString())); cur += 86400000; }
  return days;
}

function applyExcludeAdmin<T extends { phone?: string | null }>(rows: T[], staff: Set<string>): T[] {
  return rows.filter((r) => !(r.phone && staff.has(normPhone(r.phone)!)));
}

// ----------------------------- Time series -----------------------------

export interface TimeseriesPoint {
  day: string;
  visitors: number;
  registrations: number;
  logins: number;
  quizAttempts: number;
  paymentsInitiated: number;
  paid: number;
  abandoned: number;
  revenue: number;
}

/** Pre-loaded raw inputs for the timeseries aggregation (see OverviewPre). */
export interface TimeseriesPre {
  events: EventLite[];
  payments: Payment[];
  staff: Set<string>;
  attempts: QuizAttempt[];
}

export async function getAnalyticsTimeseries(opts: { from: string; to: string; excludeAdmin?: boolean }, pre?: TimeseriesPre): Promise<{ range: { from: string; to: string }; points: TimeseriesPoint[] }> {
  const fromISO = new Date(opts.from).toISOString();
  const toISO = new Date(opts.to).toISOString();
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  const excludeAdmin = !!opts.excludeAdmin;

  let allEvents: EventLite[], allPayments: Payment[], staff: Set<string>, attempts: QuizAttempt[];
  if (pre) {
    ({ events: allEvents, payments: allPayments, staff, attempts } = pre);
  } else {
    [allEvents, allPayments, staff, attempts] = await Promise.all([
      fetchEvents(fromISO, toISO),
      getPayments(),
      excludeAdmin ? getStaffPhoneSet() : Promise.resolve(new Set<string>()),
      fetchAttemptsInRange(fromMs, toMs),
    ]);
  }
  const events = excludeAdmin ? allEvents.filter((e) => !(e.phone && staff.has(normPhone(e.phone)!))) : allEvents;
  let payments = allPayments.filter((p) => !p.deleted_at && (() => { const t = new Date(p.created_at).getTime(); return t >= fromMs && t <= toMs; })());
  if (excludeAdmin) payments = applyExcludeAdmin(payments, staff);

  const days = genDaysIST(fromISO, toISO);
  const map = new Map<string, TimeseriesPoint & { _vis: Set<string> }>();
  for (const d of days) map.set(d, { day: d, visitors: 0, registrations: 0, logins: 0, quizAttempts: 0, paymentsInitiated: 0, paid: 0, abandoned: 0, revenue: 0, _vis: new Set() });
  const ensure = (k: string) => map.get(k) || map.set(k, { day: k, visitors: 0, registrations: 0, logins: 0, quizAttempts: 0, paymentsInitiated: 0, paid: 0, abandoned: 0, revenue: 0, _vis: new Set() }).get(k)!;

  for (const e of events) {
    const k = dayKeyIST(e.occurred_at); const d = ensure(k);
    if (e.visitor_id) d._vis.add(e.visitor_id);
    if (e.event_name === "registration_created") d.registrations++;
    else if (e.event_name === "login") d.logins++;
  }
  for (const a of attempts) { const d = ensure(dayKeyIST(a.started_at)); d.quizAttempts++; }
  for (const p of payments) {
    const k = dayKeyIST(p.created_at); const d = ensure(k);
    d.paymentsInitiated++;
    if ((p.status || "").toUpperCase() === "ABANDONED") d.abandoned++;
  }
  // Paid/revenue from deduped paid rows so retries don't double-count the trend.
  const paidRows = dedupePaidRows(payments.filter((p) => isPaidStatus(p.status)));
  for (const p of paidRows) { const d = ensure(dayKeyIST(p.created_at)); d.paid++; d.revenue += p.amount; }

  const points = [...map.values()].map(({ _vis, ...rest }) => ({ ...rest, visitors: _vis.size })).sort((a, b) => a.day.localeCompare(b.day));
  return { range: { from: fromISO, to: toISO }, points };
}

// ----------------------------- Student activity -----------------------------

export interface StudentActivity {
  range: { from: string; to: string };
  metrics: Record<string, number>;
  notTracked: { label: string; note: string }[];
}

export async function getStudentActivity(opts: { from: string; to: string; excludeAdmin?: boolean }): Promise<StudentActivity> {
  const fromISO = new Date(opts.from).toISOString();
  const toISO = new Date(opts.to).toISOString();
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  const excludeAdmin = !!opts.excludeAdmin;

  const [allEvents, allPayments, staff, attempts, loginPhonesAll] = await Promise.all([
    fetchEvents(fromISO, toISO),
    getPayments(),
    excludeAdmin ? getStaffPhoneSet() : Promise.resolve(new Set<string>()),
    fetchAttemptsInRange(fromMs, toMs),
    phonesWithEventAllTime("login"),
  ]);
  const events = excludeAdmin ? allEvents.filter((e) => !(e.phone && staff.has(normPhone(e.phone)!))) : allEvents;

  const idOf = (e: EventLite) => e.buyer_id || (e.phone ? normPhone(e.phone) : null);
  const loggedIn = new Set<string>();
  const viewedDashboard = new Set<string>();
  const studied = new Set<string>();
  for (const e of events) {
    const id = idOf(e);
    if (!id) continue;
    if (e.event_name === "login") loggedIn.add(id);
    if (e.event_name === "enrolled_card_viewed" || e.event_name === "course_opened") { viewedDashboard.add(id); studied.add(id); }
    if (e.event_name === "zoom_link_clicked") studied.add(id);
  }

  const takers = new Set<string>();
  const startedNotSubmitted = new Set<string>();
  for (const a of attempts) {
    const k = quizTakerKey(a); if (!k) continue;
    takers.add(k);
    if (!QUIZ_FINISHED.has(a.status)) startedNotSubmitted.add(k);
  }

  // Paid-but-never-logged-in (all-time view of paid; login checked all-time).
  const paidPhones = new Set<string>();
  for (const p of allPayments) { if (!p.deleted_at && isPaidStatus(p.status)) { const ph = normPhone(p.phone); if (ph && !(excludeAdmin && staff.has(ph))) paidPhones.add(ph); } }
  let paidNotLoggedIn = 0;
  for (const ph of paidPhones) if (!loginPhonesAll.has(ph)) paidNotLoggedIn++;

  // Logged-in in range but no study activity (no course open / card view / zoom / quiz).
  let loggedInNoStudy = 0;
  for (const id of loggedIn) {
    const isStudy = studied.has(id) || (id.length === 10 && takers.has(`p:${id}`)) || takers.has(`u:${id}`);
    if (!isStudy) loggedInNoStudy++;
  }

  return {
    range: { from: fromISO, to: toISO },
    metrics: {
      loggedInStudents: loggedIn.size,
      viewedDashboard: viewedDashboard.size,
      attemptedQuiz: takers.size,
      startedQuizNotSubmitted: startedNotSubmitted.size,
      paidNotLoggedIn,
      loggedInNoStudy,
    },
    notTracked: [
      { label: "Notes / PDF downloaded", note: "Notes links are plain downloads with no event yet — add a `note_downloaded` event to track." },
      { label: "Study material viewed (per item)", note: "Only section-level Class-Hub views and lecture watch-progress are stored, not per-item analytics events." },
    ],
  };
}

// ----------------------------- Quiz insights -----------------------------

export interface QuizInsights {
  range: { from: string; to: string };
  totals: { attempts: number; uniqueTakers: number; finished: number; inProgress: number; abandoned: number; submitRate: number | null; avgScorePct: number | null; avgAccuracy: number | null; guestAttempts: number; userAttempts: number };
  topQuizzes: { quizId: string; title: string; attempts: number; finished: number; submitRate: number | null; avgScorePct: number | null }[];
}

export async function getQuizInsights(opts: { from: string; to: string }): Promise<QuizInsights> {
  const fromISO = new Date(opts.from).toISOString();
  const toISO = new Date(opts.to).toISOString();
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();

  const [attempts, quizzes] = await Promise.all([fetchAttemptsInRange(fromMs, toMs), getAllQuizzes()]);
  const titleOf = new Map(quizzes.map((q) => [q.id, q.title] as const));

  const takers = new Set<string>();
  let finished = 0, inProgress = 0, abandoned = 0, guestAttempts = 0, userAttempts = 0;
  let scorePctSum = 0, scorePctN = 0, accSum = 0, accN = 0;
  const byQuiz = new Map<string, { attempts: number; finished: number; scorePctSum: number; scorePctN: number }>();

  for (const a of attempts) {
    const k = quizTakerKey(a); if (k) takers.add(k);
    if (a.user_id) userAttempts++; else guestAttempts++;
    if (QUIZ_FINISHED.has(a.status)) finished++;
    else if (a.status === "IN_PROGRESS") inProgress++;
    else abandoned++; // EXPIRED | ABANDONED
    const q = byQuiz.get(a.quiz_id) || { attempts: 0, finished: 0, scorePctSum: 0, scorePctN: 0 };
    q.attempts++;
    if (QUIZ_FINISHED.has(a.status)) {
      q.finished++;
      if (a.max_score > 0) { const pctv = (a.score / a.max_score) * 100; scorePctSum += pctv; scorePctN++; q.scorePctSum += pctv; q.scorePctN++; }
      if (typeof a.accuracy === "number") { accSum += a.accuracy; accN++; }
    }
    byQuiz.set(a.quiz_id, q);
  }

  const topQuizzes = [...byQuiz.entries()]
    .map(([quizId, v]) => ({ quizId, title: titleOf.get(quizId) || "Untitled quiz", attempts: v.attempts, finished: v.finished, submitRate: v.attempts > 0 ? pct(v.finished, v.attempts) : null, avgScorePct: v.scorePctN > 0 ? Math.round((v.scorePctSum / v.scorePctN) * 10) / 10 : null }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 10);

  return {
    range: { from: fromISO, to: toISO },
    totals: {
      attempts: attempts.length,
      uniqueTakers: takers.size,
      finished, inProgress, abandoned,
      submitRate: attempts.length > 0 ? pct(finished, attempts.length) : null,
      avgScorePct: scorePctN > 0 ? Math.round((scorePctSum / scorePctN) * 10) / 10 : null,
      avgAccuracy: accN > 0 ? Math.round((accSum / accN) * 10) / 10 : null,
      guestAttempts, userAttempts,
    },
    topQuizzes,
  };
}

// ----------------------------- Webinar funnel -----------------------------

export interface WebinarFunnel {
  range: { from: string; to: string };
  steps: { label: string; value: number; conversionFromPrev: number | null }[];
  webinars: { slug: string; title: string; registrations: number; paid: number; attended: number; revenue: number }[];
}

/** Pre-loaded raw inputs for the webinar-funnel aggregation (see OverviewPre). */
export interface FunnelPre {
  events: EventLite[];
  payments: Payment[];
  staff: Set<string>;
  webinars: Webinar[];
  regs: WebinarRegistration[];
}

export async function getWebinarFunnel(opts: { from: string; to: string; excludeAdmin?: boolean }, pre?: FunnelPre): Promise<WebinarFunnel> {
  const fromISO = new Date(opts.from).toISOString();
  const toISO = new Date(opts.to).toISOString();
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  const excludeAdmin = !!opts.excludeAdmin;

  let allEvents: EventLite[], allPayments: Payment[], staff: Set<string>, webinars: Webinar[], regs: WebinarRegistration[];
  if (pre) {
    ({ events: allEvents, payments: allPayments, staff, webinars, regs } = pre);
  } else {
    [allEvents, allPayments, staff, webinars, regs] = await Promise.all([
      fetchEvents(fromISO, toISO),
      getPayments(),
      excludeAdmin ? getStaffPhoneSet() : Promise.resolve(new Set<string>()),
      getWebinars(),
      getAllWebinarRegistrations(),
    ]);
  }
  const events = excludeAdmin ? allEvents.filter((e) => !(e.phone && staff.has(normPhone(e.phone)!))) : allEvents;

  const distinct = (name: string, key: (e: EventLite) => string | null) => {
    const s = new Set<string>();
    for (const e of events) if (e.event_name === name) { const k = key(e); if (k) s.add(k); }
    return s.size;
  };
  const views = distinct("webinar_view", (e) => e.visitor_id);
  const payClicks = distinct("click_register_pay", (e) => e.visitor_id || (e.phone ? normPhone(e.phone) : null));
  const registrations = events.filter((e) => e.event_name === "registration_created").length;
  const joined = distinct("zoom_link_clicked", (e) => (e.phone ? normPhone(e.phone) : e.visitor_id));

  let webinarPayments = allPayments.filter((p) => !p.deleted_at && p.item_type === "webinar" && (() => { const t = new Date(p.created_at).getTime(); return t >= fromMs && t <= toMs; })());
  if (excludeAdmin) webinarPayments = applyExcludeAdmin(webinarPayments, staff);
  const paidRows = dedupePaidRows(webinarPayments.filter((p) => isPaidStatus(p.status)));
  const paid = paidRows.length;

  const steps = [
    { label: "Webinar page views", value: views },
    { label: "Clicked register/pay", value: payClicks },
    { label: "Registered", value: registrations },
    { label: "Paid", value: paid },
    { label: "Joined (Zoom click)", value: joined },
  ].map((s, i, arr) => ({ ...s, conversionFromPrev: i === 0 || arr[i - 1].value === 0 ? null : pct(s.value, arr[i - 1].value) }));

  // Per-webinar table: registrations from webinar_registrations, paid+revenue from
  // payments(item_type=webinar) by slug, attended from zoom clicks by slug.
  const idToWeb = new Map(webinars.map((w) => [w.id, w] as const));
  const slugToTitle = new Map(webinars.map((w) => [w.slug, w.title] as const));
  const regBySlug = new Map<string, number>();
  for (const r of regs) {
    const t = new Date(r.created_at).getTime(); if (t < fromMs || t > toMs) continue;
    const w = idToWeb.get(r.webinar_id); if (!w) continue;
    regBySlug.set(w.slug, (regBySlug.get(w.slug) || 0) + 1);
  }
  const paidBySlug = new Map<string, { paid: number; revenue: number }>();
  for (const p of paidRows) { const slug = (p.item_slug || "").toLowerCase(); const cur = paidBySlug.get(slug) || { paid: 0, revenue: 0 }; cur.paid++; cur.revenue += p.amount; paidBySlug.set(slug, cur); }
  const zoomBySlug = new Map<string, Set<string>>();
  for (const e of events) if (e.event_name === "zoom_link_clicked") { const slug = String((e.props as { webinar_slug?: string } | null)?.webinar_slug || "").toLowerCase(); const id = e.phone ? normPhone(e.phone) : e.visitor_id; if (slug && id) (zoomBySlug.get(slug) || zoomBySlug.set(slug, new Set()).get(slug)!).add(id); }

  const slugs = new Set<string>([...regBySlug.keys(), ...paidBySlug.keys(), ...zoomBySlug.keys()]);
  const webinarRows = [...slugs].map((slug) => ({
    slug,
    title: slugToTitle.get(slug) || slug,
    registrations: regBySlug.get(slug) || 0,
    paid: paidBySlug.get(slug)?.paid || 0,
    attended: zoomBySlug.get(slug)?.size || 0,
    revenue: paidBySlug.get(slug)?.revenue || 0,
  })).sort((a, b) => b.revenue - a.revenue || b.registrations - a.registrations);

  return { range: { from: fromISO, to: toISO }, steps, webinars: webinarRows };
}

// ----------------------------- Payment intelligence -----------------------------

export interface PaymentIntelligence {
  range: { from: string; to: string };
  statusCounts: { initiated: number; paid: number; failed: number; abandoned: number; verifying: number; pending: number };
  revenue: number;
  paidStudents: number;
  paidTransactions: number;
  proofUploaded: number;
  adminApproved: number;
  adminApprovedAmount: number;
  revenueRecoveredViaProof: number;
  recoveryRate: number | null;
  amountStuckVerifying: number;
  duplicateAttempts: number;
}

export async function getPaymentIntelligence(opts: { from: string; to: string; excludeAdmin?: boolean }): Promise<PaymentIntelligence> {
  const fromISO = new Date(opts.from).toISOString();
  const toISO = new Date(opts.to).toISOString();
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  const excludeAdmin = !!opts.excludeAdmin;
  const db = getSupabaseAdmin();

  const [allPayments, staff] = await Promise.all([
    getPayments(),
    excludeAdmin ? getStaffPhoneSet() : Promise.resolve(new Set<string>()),
  ]);
  let payments = allPayments.filter((p) => !p.deleted_at && (() => { const t = new Date(p.created_at).getTime(); return t >= fromMs && t <= toMs; })());
  if (excludeAdmin) payments = applyExcludeAdmin(payments, staff);

  const up = (s: string) => (s || "").toUpperCase();
  const statusCounts = {
    initiated: payments.length,
    paid: payments.filter((p) => isPaidStatus(p.status)).length,
    failed: payments.filter((p) => up(p.status) === "FAILED").length,
    abandoned: payments.filter((p) => up(p.status) === "ABANDONED").length,
    verifying: payments.filter((p) => up(p.status) === "VERIFYING").length,
    pending: payments.filter((p) => up(p.status) === "PENDING").length,
  };

  const paidRowsRaw = payments.filter((p) => isPaidStatus(p.status));
  const paidRows = dedupePaidRows(paidRowsRaw);
  const revenue = dedupedPaidTotal(paidRowsRaw);
  const paidTransactions = paidRows.length;
  const paidStudentSet = new Set<string>(); for (const p of paidRows) { const ph = normPhone(p.phone); if (ph) paidStudentSet.add(ph); }
  const amountStuckVerifying = payments.filter((p) => up(p.status) === "VERIFYING").reduce((a, p) => a + (p.amount || 0), 0);
  const duplicateAttempts = paidRowsRaw.length - paidRows.length;

  // Proofs + admin approvals (from the immutable ledger).
  let proofUploaded = 0, adminApproved = 0, adminApprovedAmount = 0, revenueRecoveredViaProof = 0;
  if (db) {
    const amountByPid = new Map(payments.map((p) => [p.id, p.amount] as const));
    const proofPids = new Set<string>();
    try {
      const { data: proofs } = await db.from("payment_proofs").select("payment_id,created_at").gte("created_at", fromISO).lte("created_at", toISO);
      for (const r of (proofs as { payment_id: string }[]) || []) { proofUploaded++; if (r.payment_id) proofPids.add(r.payment_id); }
    } catch { /* ignore */ }
    try {
      const { data: approvals } = await db.from("payment_action_log").select("payment_id,new_status,created_at").eq("action", "approve").gte("created_at", fromISO).lte("created_at", toISO);
      for (const r of (approvals as { payment_id: string; new_status: string }[]) || []) {
        if ((r.new_status || "").toUpperCase() !== "PAID") continue;
        adminApproved++;
        const amt = amountByPid.get(r.payment_id) || 0;
        adminApprovedAmount += amt;
        if (proofPids.has(r.payment_id)) revenueRecoveredViaProof += amt;
      }
    } catch { /* ignore */ }
  }
  // Recovery rate = manually-approved payments ÷ (approved + still-stuck verifying).
  const recoveryDen = adminApproved + statusCounts.verifying;
  const recoveryRate = recoveryDen > 0 ? pct(adminApproved, recoveryDen) : null;

  return {
    range: { from: fromISO, to: toISO },
    statusCounts,
    revenue,
    paidStudents: paidStudentSet.size,
    paidTransactions,
    proofUploaded,
    adminApproved,
    adminApprovedAmount,
    revenueRecoveredViaProof,
    recoveryRate,
    amountStuckVerifying,
    duplicateAttempts,
  };
}

// ----------------------------- Campaign / dimension breakdown -----------------------------

export type BreakdownDimension = "campaign" | "medium" | "landing_path" | "device";

export interface BreakdownRow { key: string; label: string; visitors: number; sessions: number; registrations: number; paidStudents: number | null; revenue: number | null }

export async function getCampaignBreakdown(opts: { from: string; to: string; dimension: BreakdownDimension; excludeAdmin?: boolean }): Promise<{ range: { from: string; to: string }; dimension: BreakdownDimension; moneyAttributable: boolean; rows: BreakdownRow[] }> {
  const fromISO = new Date(opts.from).toISOString();
  const toISO = new Date(opts.to).toISOString();
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  const excludeAdmin = !!opts.excludeAdmin;
  const dim = opts.dimension;
  const moneyAttributable = dim === "campaign"; // payments only carry source + campaign

  const [allEvents, allPayments, staff] = await Promise.all([
    fetchEvents(fromISO, toISO),
    getPayments(),
    excludeAdmin ? getStaffPhoneSet() : Promise.resolve(new Set<string>()),
  ]);
  const events = excludeAdmin ? allEvents.filter((e) => !(e.phone && staff.has(normPhone(e.phone)!))) : allEvents;

  const keyOf = (e: EventLite): string => {
    if (dim === "device") return (e.device?.type || "unknown").toLowerCase();
    const ft = e.attribution?.first_touch || e.attribution?.last_touch;
    const v = dim === "medium" ? ft?.medium : dim === "landing_path" ? ft?.landing_path : ft?.campaign;
    return (v || "(none)").toString().toLowerCase();
  };

  const vis = new Map<string, Set<string>>();
  const sess = new Map<string, Set<string>>();
  const regs = new Map<string, number>();
  for (const e of events) {
    const k = keyOf(e);
    if (e.visitor_id) (vis.get(k) || vis.set(k, new Set()).get(k)!).add(e.visitor_id);
    if (e.session_id) (sess.get(k) || sess.set(k, new Set()).get(k)!).add(e.session_id);
    if (e.event_name === "registration_created") regs.set(k, (regs.get(k) || 0) + 1);
  }

  const paidStu = new Map<string, Set<string>>();
  const rev = new Map<string, number>();
  if (moneyAttributable) {
    let payments = allPayments.filter((p) => !p.deleted_at && isPaidStatus(p.status) && (() => { const t = new Date(p.created_at).getTime(); return t >= fromMs && t <= toMs; })());
    if (excludeAdmin) payments = applyExcludeAdmin(payments, staff);
    for (const p of dedupePaidRows(payments)) {
      const k = (p.attribution_campaign || "(none)").toLowerCase();
      const ph = normPhone(p.phone); if (ph) (paidStu.get(k) || paidStu.set(k, new Set()).get(k)!).add(ph);
      rev.set(k, (rev.get(k) || 0) + p.amount);
    }
  }

  const keys = new Set<string>([...vis.keys(), ...sess.keys(), ...regs.keys(), ...paidStu.keys(), ...rev.keys()]);
  const rows = [...keys].map((k) => ({
    key: k,
    label: k === "(none)" || k === "unknown" ? (dim === "device" ? "Unknown" : "(none)") : k,
    visitors: vis.get(k)?.size || 0,
    sessions: sess.get(k)?.size || 0,
    registrations: regs.get(k) || 0,
    paidStudents: moneyAttributable ? (paidStu.get(k)?.size || 0) : null,
    revenue: moneyAttributable ? (rev.get(k) || 0) : null,
  })).sort((a, b) => (b.revenue || 0) - (a.revenue || 0) || b.visitors - a.visitors);

  return { range: { from: fromISO, to: toISO }, dimension: dim, moneyAttributable, rows };
}

/* ============================================================================
 * Meta attribution report — per-campaign leads, paid webinars, paid admissions,
 * revenue, and (when an Ad Account is connected) spend / cost-per-conversion /
 * ROAS. Money is reconciled from the payments table via the SAME dedupe the
 * Payments tab uses, so revenue always ties out. Attribution is honest: money is
 * attributed only where a campaign was actually stamped on the payment; the rest
 * is shown as "untracked" and never silently assigned to a campaign.
 *
 * Coverage limits (stated in the UI): payments carry SOURCE + CAMPAIGN only, so
 * revenue splits by campaign — NOT by adset/ad (utm_content/utm_term live on the
 * click event, not the payment). Lead counts are campaign-level too.
 * ========================================================================== */
const META_SOURCES = new Set(["facebook", "instagram", "meta"]);

export interface MetaAttributionRow {
  campaign: string;
  label: string;
  source: string | null;
  isMeta: boolean;
  isUntracked: boolean;
  leads: number;
  paidWebinars: number;
  paidAdmissions: number;
  paidTotal: number;
  revenue: number;
  spend: number | null;
  costPerConversion: number | null;
  roas: number | null;
}

export interface MetaAttributionReport {
  range: { from: string; to: string };
  spendConnected: boolean;
  spendError: string | null;
  rows: MetaAttributionRow[];
  totals: { leads: number; paidWebinars: number; paidAdmissions: number; revenue: number; spend: number | null };
  coverage: { totalRevenue: number; attributedRevenue: number; untrackedRevenue: number; metaRevenue: number };
  notes: string[];
}

export async function getMetaAttribution(opts: { from: string; to: string; excludeAdmin?: boolean }): Promise<MetaAttributionReport> {
  const fromISO = new Date(opts.from).toISOString();
  const toISO = new Date(opts.to).toISOString();
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  const excludeAdmin = !!opts.excludeAdmin;

  const [allEvents, allPayments, staff, spend] = await Promise.all([
    fetchEvents(fromISO, toISO),
    getPayments(),
    excludeAdmin ? getStaffPhoneSet() : Promise.resolve(new Set<string>()),
    getMetaSpend(fromISO, toISO),
  ]);
  const events = excludeAdmin ? allEvents.filter((e) => !(e.phone && staff.has(normPhone(e.phone)!))) : allEvents;

  // Leads (free registrations) by campaign — from the click event's first touch.
  const leads = new Map<string, number>();
  for (const e of events) {
    if (e.event_name !== "registration_created") continue;
    const ft = e.attribution?.first_touch || e.attribution?.last_touch;
    const k = (ft?.campaign || "(untracked)").toLowerCase();
    leads.set(k, (leads.get(k) || 0) + 1);
  }

  // Money — reconciled from payments (PAID, deduped), split by item type.
  let payments = allPayments.filter((p) => !p.deleted_at && isPaidStatus(p.status) && (() => { const t = new Date(p.created_at).getTime(); return t >= fromMs && t <= toMs; })());
  if (excludeAdmin) payments = applyExcludeAdmin(payments, staff);

  const web = new Map<string, Set<string>>();
  const adm = new Map<string, Set<string>>();
  const rev = new Map<string, number>();
  const srcOf = new Map<string, string>();
  for (const p of dedupePaidRows(payments)) {
    const k = (p.attribution_campaign || "(untracked)").toLowerCase();
    const ph = normPhone(p.phone) || `pay:${p.id}`;
    if (p.item_type === "webinar") (web.get(k) || web.set(k, new Set()).get(k)!).add(ph);
    else if (p.item_type === "course") (adm.get(k) || adm.set(k, new Set()).get(k)!).add(ph);
    rev.set(k, (rev.get(k) || 0) + p.amount);
    if (p.attribution_source && !srcOf.has(k)) srcOf.set(k, p.attribution_source.toLowerCase());
  }

  const keys = new Set<string>([...leads.keys(), ...web.keys(), ...adm.keys(), ...rev.keys()]);
  const rows: MetaAttributionRow[] = [...keys].map((k) => {
    const isUntracked = k === "(untracked)" || k === "(none)";
    const source = srcOf.get(k) || null;
    const isMeta = !isUntracked && !!source && META_SOURCES.has(source);
    const paidWebinars = web.get(k)?.size || 0;
    const paidAdmissions = adm.get(k)?.size || 0;
    const paidTotal = paidWebinars + paidAdmissions;
    const revenue = rev.get(k) || 0;
    const campaignSpend = spend.configured && !isUntracked ? (spend.byCampaign.get(k) ?? null) : null;
    return {
      campaign: k,
      label: isUntracked ? "Untracked / pre-tracking" : k,
      source,
      isMeta,
      isUntracked,
      leads: leads.get(k) || 0,
      paidWebinars,
      paidAdmissions,
      paidTotal,
      revenue,
      spend: campaignSpend,
      costPerConversion: campaignSpend !== null && paidTotal > 0 ? Math.round(campaignSpend / paidTotal) : null,
      roas: campaignSpend !== null && campaignSpend > 0 ? Number((revenue / campaignSpend).toFixed(2)) : null,
    };
  }).sort((a, b) => Number(a.isUntracked) - Number(b.isUntracked) || b.revenue - a.revenue || b.paidTotal - a.paidTotal);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const untrackedRevenue = rows.filter((r) => r.isUntracked).reduce((s, r) => s + r.revenue, 0);
  const metaRevenue = rows.filter((r) => r.isMeta).reduce((s, r) => s + r.revenue, 0);
  const totalSpend = spend.configured ? rows.reduce((s, r) => s + (r.spend || 0), 0) : null;

  return {
    range: { from: fromISO, to: toISO },
    spendConnected: spend.configured,
    spendError: spend.error || null,
    rows,
    totals: {
      leads: rows.reduce((s, r) => s + r.leads, 0),
      paidWebinars: rows.reduce((s, r) => s + r.paidWebinars, 0),
      paidAdmissions: rows.reduce((s, r) => s + r.paidAdmissions, 0),
      revenue: totalRevenue,
      spend: totalSpend,
    },
    coverage: {
      totalRevenue,
      attributedRevenue: totalRevenue - untrackedRevenue,
      untrackedRevenue,
      metaRevenue,
    },
    notes: [
      "Revenue reconciles to the Payments tab (PAID, deduped). Money is attributed only where a campaign was stamped on the payment; the rest is shown as Untracked, never guessed.",
      "Payments carry source + campaign only, so revenue splits by campaign — not by adset/ad. Lead counts are campaign-level.",
      spend.configured
        ? "Spend/CPA/ROAS come from the connected Meta Ad Account, matched to campaigns by name (utm_campaign must equal the Meta campaign name)."
        : "Connect META_AD_ACCOUNT_ID to show spend, cost-per-conversion and ROAS.",
    ],
  };
}
