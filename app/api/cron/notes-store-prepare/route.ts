import { NextResponse } from "next/server";
import { autoPreparePaidOrders } from "@/lib/store/autoPrepare";
import { storeDb } from "@/lib/store/db";
import { runMissedDelhiveryPickupRepair } from "@/lib/store/shipping/cancelMissedPickups";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Paid New → Preparing after five minutes. Does not touch payment rows.
 * Also retires Delhivery waybills whose scheduled pickup day has passed without collection.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }
  const result = await autoPreparePaidOrders();
  const db = storeDb();
  const missedPickups = db ? await runMissedDelhiveryPickupRepair(db) : { considered: 0, cancelled: 0, alreadyCancelled: 0, skipped: 0, errors: 1 };
  return NextResponse.json({ ok: true, ...result, missedPickups, ts: Date.now() });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
