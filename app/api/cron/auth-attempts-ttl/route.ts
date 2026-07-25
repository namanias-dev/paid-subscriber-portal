import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { pruneAuthAttempts, RETAIN_HOURS } from "@/lib/ops/authAttemptsTtl";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `auth_attempts` retention. Deletes rate-limit counter rows older than 24 h
 * via the chunked, set-based `prune_auth_attempts` RPC.
 *
 * Left unpruned the table reached 45 MB / 217,799 rows, 98.5% of which no
 * caller could still read — the widest `rateLimited()` window is 3,600 s.
 * Fully idempotent, so a missed run costs nothing but a larger next sweep.
 *
 * Protected by CRON_SECRET (Authorization: Bearer <secret> or ?secret=).
 * Runs every 6 hours via vercel.json.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, skipped: "no-db" });

  const result = await pruneAuthAttempts(
    db as unknown as Parameters<typeof pruneAuthAttempts>[0],
    RETAIN_HOURS,
  );
  if (!result.ok) {
    console.warn(`[auth-attempts-ttl] prune failed: ${result.error}`);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: result.deleted, retainHours: RETAIN_HOURS, ts: Date.now() });
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
