import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Refresh today and yesterday's analytics rollups every few minutes.
 * Older days stay frozen. Dashboard reads never call this.
 * Failure here must not affect checkout, cart, or payments — this route only
 * writes rollup tables.
 */
const IST_MS = 5.5 * 3600 * 1000;

function istDay(ms: number): string {
  return new Date(ms + IST_MS).toISOString().slice(0, 10);
}

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, skipped: "no-db" });
  const today = istDay(Date.now());
  const yesterday = istDay(Date.now() - 86400000);
  const { data, error } = await db.rpc("refresh_analytics_rollups", { p_from: yesterday, p_to: today });
  if (error) return NextResponse.json({ ok: false, error: "rollup_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, result: data });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
