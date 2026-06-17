import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Keep-alive endpoint. Hit daily (Vercel cron or cron-job.org) to stop
 * Supabase free tier from pausing. Protected by CRON_SECRET when set.
 */
export async function GET(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const url = new URL(req.url);
      const provided =
        url.searchParams.get("secret") ||
        req.headers.get("authorization")?.replace("Bearer ", "");
      if (provided !== secret) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    }

    if (isDemoMode) {
      return NextResponse.json({ ok: true, demo: true, ts: Date.now() });
    }

    const db = getSupabaseAdmin();
    if (db) {
      await db.from("students").select("id").limit(1);
    }
    return NextResponse.json({ ok: true, ts: Date.now() });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
