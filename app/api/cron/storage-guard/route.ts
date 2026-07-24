import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { checkStorageHealth, WARN_THRESHOLD } from "@/lib/ops/storageGuard";

export const dynamic = "force-dynamic";

/**
 * Storage headroom check. Run it on the daily cron alongside the other
 * maintenance jobs.
 *
 * Returns HTTP 200 while storage is healthy and HTTP 507 (Insufficient
 * Storage) once utilisation crosses the warning threshold, so any uptime
 * monitor already pointed at this URL raises an alert without extra wiring —
 * the point being that on 2026-07-24 there was no signal at all between
 * "fine" and "the database is read-only".
 *
 * Protected by CRON_SECRET, consistent with the other cron routes.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided =
      url.searchParams.get("secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  const health = await checkStorageHealth(
    getSupabaseAdmin() as unknown as Parameters<typeof checkStorageHealth>[0],
  );
  if (!health) return NextResponse.json({ ok: true, skipped: "no-db" });

  const body = {
    ok: health.level === "ok",
    level: health.level,
    message: health.message,
    usedBytes: health.usedBytes,
    diskBytes: health.diskBytes,
    utilisation: Number(health.utilisation.toFixed(4)),
    warnAt: WARN_THRESHOLD,
    ts: Date.now(),
  };

  if (health.level !== "ok") {
    console.warn(`[storage-guard] ${health.message}`);
    return NextResponse.json(body, { status: 507 });
  }
  return NextResponse.json(body);
}
