import { NextResponse } from "next/server";
import { pollDeliveryStatuses } from "@/lib/sms/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dedicated DLR pull — promotes open SENT sms_logs to DELIVERED/FAILED via
 * JustGoSMS http-dlr.php. Separated from sms-dispatch so receipts update even
 * when the hourly/daily send jobs have nothing to do.
 *
 * Auth: CRON_SECRET via ?secret= or Authorization: Bearer.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  try {
    const dlr = await pollDeliveryStatuses({ sinceDays: 3, limit: 500 });
    return NextResponse.json({
      ok: true,
      scanned: dlr.scanned,
      delivered: dlr.delivered,
      failed: dlr.failed,
      pending: dlr.pending,
      unknown: dlr.unknown,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
