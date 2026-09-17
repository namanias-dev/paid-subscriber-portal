import { NextResponse } from "next/server";
import { sweepStoreVerify } from "@/lib/store/payments/verify";
import { storeMisrouteProbe } from "@/lib/store/payments/misrouteProbe";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The store's OWN Verify sweep. Separate cron, separate table, separate status
 * mapping from /api/cron/verify-payments, which is never modified.
 *
 * Runs even when the store kill switch is off: if the store is taken dark while
 * a customer's payment is in flight, that payment must still be resolved. Money
 * integrity outlives a feature flag.
 *
 * Protected by CRON_SECRET, same convention as the course cron:
 *     GET /api/cron/notes-store-verify?secret=<CRON_SECRET>
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
    const result = await sweepStoreVerify({ limit: 200 });
    const misroute = await storeMisrouteProbe();
    return NextResponse.json({ ok: true, result, misroute, ts: Date.now() });
  } catch (e) {
    console.error("[cron/notes-store-verify] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
