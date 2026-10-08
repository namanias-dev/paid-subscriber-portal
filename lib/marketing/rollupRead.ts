/**
 * Read path for Growth Intelligence and Campaign Links.
 * Pages sum precomputed daily rollups. A cron refreshes today and yesterday;
 * these reads never rebuild a day, and they never run from checkout or payment code.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { NON_ATTRIBUTABLE_SOURCES, sourceLabel } from "@/lib/analytics/metrics";
import type { TouchSourceFunnel, TouchSourceRow } from "@/lib/analytics/queries";
import { pct } from "./funnelMath";

const IST_MS = 5.5 * 3600 * 1000;

export function istDay(iso: string): string {
  return new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
}

export interface CampaignRollupRow {
  short_code: string;
  clicks: number;
  product_views: number;
  add_to_cart_events: number;
  add_to_cart_users: number;
  checkout_users: number;
  visitors: number;
  registrations: number;
  leads: number;
  orders_created: number;
  paid_orders: number;
  units: number;
  revenue_paise: number;
  paid_admissions: number;
  paid_webinars: number;
  admissions_revenue: number;
  updated_at: string | null;
}

/** Newest rollup timestamp in the window. Refreshing is the cron's job so a page load stays a single indexed read. */
async function freshnessStamp(fromISO: string, toISO: string): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  try {
    const { data } = await db
      .from("analytics_rollup_meta")
      .select("updated_at")
      .gte("rollup_date", istDay(fromISO))
      .lte("rollup_date", istDay(toISO))
      .order("updated_at", { ascending: false })
      .limit(1);
    const updated = (data || [])[0] as { updated_at?: string } | undefined;
    return updated?.updated_at || null;
  } catch {
    return null;
  }
}

export async function readCampaignWindow(fromISO: string, toISO: string): Promise<{ rows: CampaignRollupRow[]; updatedAt: string | null }> {
  const updatedAt = await freshnessStamp(fromISO, toISO);
  const db = getSupabaseAdmin();
  if (!db) return { rows: [], updatedAt };
  try {
    const { data, error } = await db.rpc("campaign_link_window", {
      p_from: istDay(fromISO),
      p_to: istDay(toISO),
    });
    if (error) return { rows: [], updatedAt };
    const rows = ((data || []) as CampaignRollupRow[]).map((row) => ({
      ...row,
      clicks: Number(row.clicks) || 0,
      product_views: Number(row.product_views) || 0,
      add_to_cart_events: Number(row.add_to_cart_events) || 0,
      add_to_cart_users: Number(row.add_to_cart_users) || 0,
      checkout_users: Number(row.checkout_users) || 0,
      visitors: Number(row.visitors) || 0,
      registrations: Number(row.registrations) || 0,
      leads: Number(row.leads) || 0,
      orders_created: Number(row.orders_created) || 0,
      paid_orders: Number(row.paid_orders) || 0,
      units: Number(row.units) || 0,
      revenue_paise: Number(row.revenue_paise) || 0,
      paid_admissions: Number(row.paid_admissions) || 0,
      paid_webinars: Number(row.paid_webinars) || 0,
      admissions_revenue: Number(row.admissions_revenue) || 0,
    }));
    const newest = rows.reduce<string | null>((acc, row) => {
      if (!row.updated_at) return acc;
      if (!acc || row.updated_at > acc) return row.updated_at;
      return acc;
    }, updatedAt);
    return { rows, updatedAt: newest };
  } catch {
    return { rows: [], updatedAt };
  }
}

function buildTouchRow(source: string, visitors: number, registrations: number, paidStudents: number, revenue: number): TouchSourceRow {
  const isSpecial = NON_ATTRIBUTABLE_SOURCES.has(source);
  return {
    source,
    label: sourceLabel(source),
    isSpecial,
    visitors,
    registrations,
    paidStudents,
    revenue,
    visitorToRegistration: !isSpecial && visitors > 0 ? pct(registrations, visitors) : null,
    registrationToPaid: registrations > 0 ? pct(paidStudents, registrations) : null,
    visitorToPaid: !isSpecial && visitors > 0 ? pct(paidStudents, visitors) : null,
    revenuePerVisitor: !isSpecial && visitors > 0 ? Math.round(revenue / visitors) : null,
  };
}

export async function readGrowthWindow(opts: {
  from: string;
  to: string;
  touch: "first" | "last";
  excludeAdmin?: boolean;
}): Promise<TouchSourceFunnel & { updatedAt: string | null }> {
  const updatedAt = await freshnessStamp(opts.from, opts.to);
  const db = getSupabaseAdmin();
  const emptyTotals = buildTouchRow("__total__", 0, 0, 0, 0);
  emptyTotals.label = "Total";
  emptyTotals.isSpecial = false;
  const base = {
    range: { from: new Date(opts.from).toISOString(), to: new Date(opts.to).toISOString() },
    touch: opts.touch,
    excludeAdmin: !!opts.excludeAdmin,
    rows: [] as TouchSourceRow[],
    totals: emptyTotals,
    updatedAt,
  };
  if (!db) return base;
  try {
    const { data, error } = await db.rpc("growth_touch_window", {
      p_from: istDay(opts.from),
      p_to: istDay(opts.to),
      p_touch: opts.touch,
      p_exclude_staff: !!opts.excludeAdmin,
    });
    if (error) return base;
    const raw = (data || []) as { source: string; visitors: number; registrations: number; paid_students: number; revenue: number; updated_at: string | null }[];
    const rows = raw
      .map((row) => buildTouchRow(row.source, Number(row.visitors) || 0, Number(row.registrations) || 0, Number(row.paid_students) || 0, Number(row.revenue) || 0))
      .sort((a, b) => (a.isSpecial !== b.isSpecial ? (a.isSpecial ? 1 : -1) : b.revenue - a.revenue || b.visitors - a.visitors));
    const totals = buildTouchRow(
      "__total__",
      rows.reduce((s, r) => s + r.visitors, 0),
      rows.reduce((s, r) => s + r.registrations, 0),
      rows.reduce((s, r) => s + r.paidStudents, 0),
      rows.reduce((s, r) => s + r.revenue, 0),
    );
    totals.label = "Total";
    totals.isSpecial = false;
    totals.visitorToPaid = null;
    const newest = raw.reduce<string | null>((acc, row) => (!row.updated_at ? acc : !acc || row.updated_at > acc ? row.updated_at : acc), updatedAt);
    return { ...base, rows, totals, updatedAt: newest };
  } catch {
    return base;
  }
}
