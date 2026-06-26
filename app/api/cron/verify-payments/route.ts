import { NextResponse } from "next/server";
import { reverifyPayments } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background payment re-verification sweep.
 *
 * Re-checks DUE non-paid payments (backoff: ~2,5,10,30,60 min, then 6-hourly up
 * to T+3 days) against ICICI's Verify URL + stored callback evidence, upgrading
 * to PAID / FAILED / ABANDONED as ICICI dictates. A timer never produces FAILED.
 *
 * Vercel Hobby allows only DAILY Vercel crons, so the real cadence comes from a
 * FREE external scheduler (cron-job.org / GitHub Actions) hitting this endpoint
 * every few minutes:
 *     GET /api/cron/verify-payments?secret=<CRON_SECRET>
 * Protected by CRON_SECRET (header `Authorization: Bearer <secret>` or `?secret=`).
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided =
      url.searchParams.get("secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }
  try {
    const result = await reverifyPayments({ onlyDue: true, limit: 500 });
    return NextResponse.json({ ok: true, result, ts: Date.now() });
  } catch (e) {
    console.error("[cron/verify-payments] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
