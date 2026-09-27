import { NextResponse } from "next/server";
import { autoPreparePaidOrders } from "@/lib/store/autoPrepare";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Paid New → Preparing after five minutes. Does not touch payment rows. */
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
  return NextResponse.json({ ok: true, ...result, ts: Date.now() });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
