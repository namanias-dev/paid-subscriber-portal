/**
 * Read-side analytics queries for the admin command center.
 *
 * RECONCILIATION RULE: all money/seat numbers come from the `payments` table via
 * lib/paymentsAgg (the SAME dedupe the Payments tab uses), never from the event
 * log — so the dashboard always ties out to Payments. Events power behaviour,
 * funnel and source attribution only.
 */
import { getSupabaseAdmin } from "../supabase";
import { getPayments } from "../dataProvider";
import { isPaidStatus, dedupePaidRows, dedupedPaidTotal, distinctRegistrations, itemKey } from "../paymentsAgg";
import { normalizeIndianMobile } from "../phone";
import type { Payment } from "../types";

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
  occurred_at: string;
  page_path: string | null;
  attribution: { first_touch?: { source?: string; campaign?: string }; last_touch?: { source?: string; campaign?: string } } | null;
  props: Record<string, unknown> | null;
}

function normPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const n = normalizeIndianMobile(p);
  return n.ok && n.digits10 ? n.digits10 : String(p).replace(/\D/g, "").slice(-10) || null;
}

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

async function fetchEvents(fromISO: string, toISO: string): Promise<EventLite[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("analytics_events")
    .select("event_id,event_name,visitor_id,buyer_id,phone,occurred_at,page_path,attribution,props")
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

export type SegmentKey = "paid_not_logged_in" | "payment_pending_or_abandoned" | "clicked_pay_not_paid" | "paid_not_clicked_zoom";

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
