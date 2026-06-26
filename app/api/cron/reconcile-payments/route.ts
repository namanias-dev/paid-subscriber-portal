import { NextResponse } from "next/server";
import { reconcileStalePendingPayments } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

/**
 * Scheduled sweep: expire stale PENDING payments (webinar + course) past the
 * timeout window to a terminal state (PAID if stored gateway evidence confirms
 * success, otherwise FAILED). Pending-only, idempotent, never touches paid/failed.
 *
 * Registered as a Vercel cron in vercel.json. Protected by CRON_SECRET when set
 * (Vercel cron sends `Authorization: Bearer <CRON_SECRET>`; external callers may
 * also pass `?secret=`).
 */
export async function GET(req: Request) {
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

  try {
    const result = await reconcileStalePendingPayments();
    return NextResponse.json({ ok: true, ...result, ts: Date.now() });
  } catch (e) {
    console.error("[cron/reconcile-payments] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
