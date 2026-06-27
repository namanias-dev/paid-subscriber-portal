import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nightly analytics maintenance:
 *  1. Roll up the last few days of behaviour into analytics_daily (cheap reads
 *     long-term; revenue/seats always stay live via paymentsAgg on the dashboard).
 *  2. Prune high-volume page_view/session_start noise older than 90 days. Business
 *     milestones (payments, registrations, logins, identity, staff, consent) are
 *     NEVER pruned.
 *
 * Protected by CRON_SECRET (Authorization: Bearer <secret> or ?secret=).
 * Vercel Hobby = daily cron; can also be hit by any external scheduler.
 */
const PRUNE_EVENTS = ["page_view", "session_start"];
const PRUNE_AFTER_DAYS = 90;

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, skipped: "no-db" });

  try {
    // ---- 1. Roll up the last 3 IST days ----
    const days: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(Date.now() - i * 86400000 + 5.5 * 3600 * 1000);
      days.push(d.toISOString().slice(0, 10));
    }
    let rolled = 0;
    for (const day of days) {
      const fromISO = new Date(`${day}T00:00:00+05:30`).toISOString();
      const toISO = new Date(`${day}T23:59:59+05:30`).toISOString();
      const { data } = await db
        .from("analytics_events")
        .select("event_name,visitor_id,attribution")
        .gte("occurred_at", fromISO)
        .lte("occurred_at", toISO)
        .eq("is_bot", false)
        .limit(100000);
      const rows = (data as { event_name: string; visitor_id: string | null; attribution: { first_touch?: { source?: string } } | null }[]) || [];
      const visitors = new Set<string>();
      const metrics: Record<string, number> = { page_views: 0, sessions: 0, registrations: 0, paid: 0 };
      const bySource: Record<string, { visitors: Set<string>; registrations: number }> = {};
      for (const r of rows) {
        if (r.visitor_id) visitors.add(r.visitor_id);
        if (r.event_name === "page_view") metrics.page_views++;
        if (r.event_name === "session_start") metrics.sessions++;
        if (r.event_name === "registration_created") metrics.registrations++;
        if (r.event_name === "payment_paid") metrics.paid++;
        const s = r.attribution?.first_touch?.source || "direct";
        if (!bySource[s]) bySource[s] = { visitors: new Set(), registrations: 0 };
        if (r.visitor_id) bySource[s].visitors.add(r.visitor_id);
        if (r.event_name === "registration_created") bySource[s].registrations++;
      }
      const bySourceOut: Record<string, { visitors: number; registrations: number }> = {};
      for (const [k, v] of Object.entries(bySource)) bySourceOut[k] = { visitors: v.visitors.size, registrations: v.registrations };
      await db.from("analytics_daily").upsert({
        day,
        metrics: { ...metrics, visitors: visitors.size },
        by_source: bySourceOut,
        updated_at: new Date().toISOString(),
      });
      rolled++;
    }

    // ---- 2. Prune old high-volume traffic noise ----
    const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 86400000).toISOString();
    const { count } = await db
      .from("analytics_events")
      .delete({ count: "estimated" })
      .in("event_name", PRUNE_EVENTS)
      .lt("occurred_at", cutoff);

    return NextResponse.json({ ok: true, rolled, pruned: count ?? null, ts: Date.now() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
