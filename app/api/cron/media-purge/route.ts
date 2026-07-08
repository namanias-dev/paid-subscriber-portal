import { NextResponse } from "next/server";
import { purgeDueMedia } from "@/lib/mediaCascade";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Grace-period media purge. Deletes R2 objects whose delete-cascade grace window
 * has elapsed (media_deletion_log rows: status='pending', purge_after<=now).
 * Re-checks references at purge time and treats already-gone objects as success,
 * so it's fully idempotent and safe to run repeatedly.
 *
 * Protected by CRON_SECRET (Authorization: Bearer <secret> or ?secret=).
 * Runs daily via vercel.json; can also be triggered by any external scheduler.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await purgeDueMedia();
    return NextResponse.json({
      ok: true,
      purged: result.purged.length,
      skippedReferenced: result.skippedReferenced.length,
      missing: result.missing.length,
      failed: result.failed.length,
      ts: Date.now(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
