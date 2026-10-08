/**
 * Link-level full-funnel analytics for Campaign Links.
 *
 * Reads daily rollups (not a live scan). The join key is the campaign-link
 * short code (`clid`) that rides the existing nsa_attr JSONB touch and lands on:
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
import { aov, pct } from "./funnelMath";
import { readCampaignWindow, type CampaignRollupRow } from "./rollupRead";

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
  productViews: number;
  addToCartUsers: number;
  addToCartEvents: number;
  checkoutUsers: number;
  ordersCreated: number;
  paidOrders: number;
  units: number;
  aov: number | null;
  visitorToCart: number | null;
  cartToCheckout: number | null;
  checkoutToPaid: number | null;
  visitorToPaid: number | null;
  revenuePerVisitor: number | null;
  updatedAt: string | null;
}

export const EMPTY_METRICS: LinkMetrics = {
  clicks: 0, uniqueVisitors: 0, registrations: 0, leads: 0, checkoutStarted: 0,
  orders: 0, ordersRevenue: 0, paidAdmissions: 0, paidWebinars: 0, admissionsRevenue: 0,
  revenue: 0, clickToRegistration: null, registrationToPaid: null, clickToPaid: null,
  productViews: 0, addToCartUsers: 0, addToCartEvents: 0, checkoutUsers: 0, ordersCreated: 0,
  paidOrders: 0, units: 0, aov: null, visitorToCart: null, cartToCheckout: null,
  checkoutToPaid: null, visitorToPaid: null, revenuePerVisitor: null, updatedAt: null,
};

function toMetrics(row: CampaignRollupRow, updatedAt: string | null): LinkMetrics {
  const ordersRevenue = Math.round((row.revenue_paise || 0) / 100);
  const admissionsRevenue = Math.round(Number(row.admissions_revenue) || 0);
  const revenue = ordersRevenue + admissionsRevenue;
  const paidTotal = row.paid_admissions + row.paid_webinars;
  return {
    clicks: row.clicks,
    uniqueVisitors: row.visitors,
    registrations: row.registrations,
    leads: row.leads,
    checkoutStarted: row.checkout_users,
    orders: row.paid_orders,
    ordersRevenue,
    paidAdmissions: row.paid_admissions,
    paidWebinars: row.paid_webinars,
    admissionsRevenue,
    revenue,
    clickToRegistration: pct(row.registrations, row.clicks),
    registrationToPaid: pct(paidTotal + row.paid_orders, row.registrations),
    clickToPaid: pct(paidTotal + row.paid_orders, row.clicks),
    productViews: row.product_views,
    addToCartUsers: row.add_to_cart_users,
    addToCartEvents: row.add_to_cart_events,
    checkoutUsers: row.checkout_users,
    ordersCreated: row.orders_created,
    paidOrders: row.paid_orders,
    units: row.units,
    aov: aov(ordersRevenue, row.paid_orders),
    visitorToCart: pct(row.add_to_cart_users, row.visitors),
    cartToCheckout: pct(row.checkout_users, row.add_to_cart_users),
    checkoutToPaid: pct(row.paid_orders, row.checkout_users),
    visitorToPaid: pct(row.paid_orders, row.visitors),
    revenuePerVisitor: row.visitors > 0 ? Math.round(ordersRevenue / row.visitors) : null,
    updatedAt: row.updated_at || updatedAt,
  };
}

/**
 * Funnel metrics per campaign-link short_code. Reads the daily rollup (one
 * grouped query) instead of scanning events, orders, buyers and payments.
 */
export async function getCampaignLinkMetrics(opts: { from: string; to: string; shortCode?: string }): Promise<Map<string, LinkMetrics>> {
  const { rows, updatedAt } = await readCampaignWindow(opts.from, opts.to);
  const want = opts.shortCode?.trim().toLowerCase();
  const out = new Map<string, LinkMetrics>();
  for (const row of rows) {
    const code = (row.short_code || "").toLowerCase();
    if (!code || (want && code !== want)) continue;
    out.set(code, toMetrics(row, updatedAt));
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
