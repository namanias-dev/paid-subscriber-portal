/**
 * Link-level full-funnel analytics for Campaign Links.
 *
 * Joins the branded short link back to real conversions WITHOUT duplicating any
 * analytics system. The join key is the campaign-link id (`clid`) that rides the
 * existing nsa_attr JSONB touch and therefore lands on:
 *   - analytics_events.attribution  → clicks' behaviour, registrations, checkout
 *   - store_orders.attribution_json → Notes orders + revenue
 *   - buyers.first_touch/last_touch → phone↔clid map → payments (admissions) + leads
 *
 * Money reconciles to the Payments / store_orders tables (deduped), never events.
 * First-touch wins (clid = first_touch.clid ?? last_touch.clid), consistent with
 * the rest of the attribution system. Nothing is invented.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchEvents } from "@/lib/analytics/queries";
import { getPayments } from "@/lib/dataProvider";
import { dedupePaidRows, isPaidStatus } from "@/lib/paymentsAgg";
import { normPhone } from "@/lib/phone";
import type { AttributionState } from "@/lib/attribution";

export interface LinkMetrics {
  clicks: number;
  uniqueVisitors: number;
  registrations: number;
  leads: number;
  checkoutStarted: number;
  orders: number;
  ordersRevenue: number;
  paidAdmissions: number;
  paidWebinars: number;
  admissionsRevenue: number;
  revenue: number; // ordersRevenue + admissionsRevenue
  clickToRegistration: number | null;
  registrationToPaid: number | null;
  clickToPaid: number | null;
}

export const EMPTY_METRICS: LinkMetrics = {
  clicks: 0, uniqueVisitors: 0, registrations: 0, leads: 0, checkoutStarted: 0,
  orders: 0, ordersRevenue: 0, paidAdmissions: 0, paidWebinars: 0, admissionsRevenue: 0,
  revenue: 0, clickToRegistration: null, registrationToPaid: null, clickToPaid: null,
};

function clidOf(attr: AttributionState | null | undefined): string | null {
  const c = attr?.first_touch?.clid || attr?.last_touch?.clid;
  return (c || "").toString().trim().toLowerCase() || null;
}

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

interface Acc {
  clicks: number;
  visitors: Set<string>;
  registrations: number;
  leads: number;
  checkoutStarted: number;
  orders: number;
  ordersRevenue: number;
  paidAdmissions: Set<string>;
  paidWebinars: Set<string>;
  admissionsRevenue: number;
}
const freshAcc = (): Acc => ({
  clicks: 0, visitors: new Set(), registrations: 0, leads: 0, checkoutStarted: 0,
  orders: 0, ordersRevenue: 0, paidAdmissions: new Set(), paidWebinars: new Set(), admissionsRevenue: 0,
});

/**
 * Aggregate funnel metrics per campaign-link short_code for a time window.
 * Returns a Map keyed by lower-case short_code.
 */
export async function getCampaignLinkMetrics(opts: { from: string; to: string }): Promise<Map<string, LinkMetrics>> {
  const fromISO = new Date(opts.from).toISOString();
  const toISO = new Date(opts.to).toISOString();
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  const db = getSupabaseAdmin();

  const acc = new Map<string, Acc>();
  const bump = (code: string | null): Acc | null => {
    if (!code) return null;
    let a = acc.get(code);
    if (!a) { a = freshAcc(); acc.set(code, a); }
    return a;
  };

  // 1) Clicks + unique visitors (clicks table; bots excluded).
  if (db) {
    const { data: clicks } = await db
      .from("campaign_link_clicks")
      .select("short_code,visitor_id")
      .gte("occurred_at", fromISO)
      .lte("occurred_at", toISO)
      .eq("is_bot", false)
      .limit(100000);
    for (const c of (clicks as { short_code: string; visitor_id: string | null }[]) || []) {
      const a = bump((c.short_code || "").toLowerCase());
      if (!a) continue;
      a.clicks += 1;
      if (c.visitor_id) a.visitors.add(c.visitor_id);
    }
  }

  // 2) Behaviour from analytics_events carrying a clid.
  const events = await fetchEvents(fromISO, toISO);
  for (const e of events) {
    const code = clidOf(e.attribution as AttributionState | null);
    const a = bump(code);
    if (!a) continue;
    if (e.visitor_id) a.visitors.add(e.visitor_id);
    if (e.event_name === "registration_created") a.registrations += 1;
    else if (e.event_name === "notes_checkout_started") a.checkoutStarted += 1;
  }

  // 3) Notes orders + revenue (store_orders.attribution_json).
  if (db) {
    const { data: orders } = await db
      .from("store_orders")
      .select("attribution_json,amount_paid_paise,status,created_at")
      .gte("created_at", fromISO)
      .lte("created_at", toISO)
      .limit(100000);
    const PAID_LIKE = new Set([
      "PAID", "CONFIRMED", "PRINTING", "PACKED", "READY_TO_SHIP", "SHIPPED",
      "DELIVERED", "FULFILLED", "COMPLETED",
    ]);
    for (const o of (orders as { attribution_json: AttributionState | null; amount_paid_paise: number | null; status: string }[]) || []) {
      const code = clidOf(o.attribution_json);
      const a = bump(code);
      if (!a) continue;
      if (PAID_LIKE.has((o.status || "").toUpperCase())) {
        a.orders += 1;
        a.ordersRevenue += (o.amount_paid_paise || 0) / 100;
      }
    }
  }

  // 4) Admissions / paid webinars + revenue via buyers phone↔clid, then payments.
  const phoneToClid = new Map<string, string>();
  if (db) {
    const { data: buyers } = await db
      .from("buyers")
      .select("phone,first_touch,last_touch")
      .limit(100000);
    for (const b of (buyers as { phone: string; first_touch: { clid?: string } | null; last_touch: { clid?: string } | null }[]) || []) {
      const code = (b.first_touch?.clid || b.last_touch?.clid || "").toString().trim().toLowerCase();
      const ph = normPhone(b.phone);
      if (code && ph && !phoneToClid.has(ph)) phoneToClid.set(ph, code);
    }
  }
  if (phoneToClid.size > 0) {
    const allPayments = await getPayments();
    const paid = dedupePaidRows(
      allPayments.filter((p) => {
        if (p.deleted_at || !isPaidStatus(p.status)) return false;
        const t = new Date(p.created_at).getTime();
        return t >= fromMs && t <= toMs;
      }),
    );
    for (const p of paid) {
      const ph = normPhone(p.phone);
      const code = ph ? phoneToClid.get(ph) : undefined;
      const a = bump(code || null);
      if (!a) continue;
      const payer = ph || `pay:${p.id}`;
      if (p.item_type === "course") a.paidAdmissions.add(payer);
      else if (p.item_type === "webinar") a.paidWebinars.add(payer);
      a.admissionsRevenue += p.amount || 0;
    }

    // 5) Leads via the same bounded phone set (leads table is huge; filter by phone).
    if (db) {
      const phones = [...phoneToClid.keys()];
      const CHUNK = 300;
      for (let i = 0; i < phones.length; i += CHUNK) {
        const slice = phones.slice(i, i + CHUNK);
        const { data: leads } = await db
          .from("leads")
          .select("phone_key,created_at")
          .in("phone_key", slice)
          .gte("created_at", fromISO)
          .lte("created_at", toISO);
        for (const l of (leads as { phone_key: string | null }[]) || []) {
          const ph = normPhone(l.phone_key);
          const code = ph ? phoneToClid.get(ph) : undefined;
          const a = bump(code || null);
          if (a) a.leads += 1;
        }
      }
    }
  }

  // Finalise.
  const out = new Map<string, LinkMetrics>();
  for (const [code, a] of acc) {
    const paidAdmissions = a.paidAdmissions.size;
    const paidWebinars = a.paidWebinars.size;
    const paidTotal = paidAdmissions + paidWebinars;
    const revenue = a.ordersRevenue + a.admissionsRevenue;
    out.set(code, {
      clicks: a.clicks,
      uniqueVisitors: a.visitors.size,
      registrations: a.registrations,
      leads: a.leads,
      checkoutStarted: a.checkoutStarted,
      orders: a.orders,
      ordersRevenue: Math.round(a.ordersRevenue),
      paidAdmissions,
      paidWebinars,
      admissionsRevenue: Math.round(a.admissionsRevenue),
      revenue: Math.round(revenue),
      clickToRegistration: pct(a.registrations, a.clicks),
      registrationToPaid: pct(paidTotal + a.orders, a.registrations),
      clickToPaid: pct(paidTotal + a.orders, a.clicks),
    });
  }
  return out;
}

export interface LinkClickRow {
  occurred_at: string;
  visitor_id: string | null;
  referrer: string | null;
  device: { type?: string; os?: string; browser?: string } | null;
}

/** Recent raw clicks for one link (detail view). */
export async function getRecentClicks(linkId: string, limit = 50): Promise<LinkClickRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("campaign_link_clicks")
    .select("occurred_at,visitor_id,referrer,device")
    .eq("campaign_link_id", linkId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data as LinkClickRow[]) || [];
}
