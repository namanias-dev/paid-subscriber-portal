import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import {
  alertNoLeadsIfStale,
  alertOverdueInstallments,
  alertWebinarReminders24h,
  maybeRunScheduledDigest,
} from "@/lib/telegram/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: Request) {
  const authorized =
    authorizeCron(req, process.env.CRON_SECRET) ||
    authorizeCron(req, process.env.TELEGRAM_WEBHOOK_SECRET);
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Manual force via ?force=1 or action=send_now — skips slot-hour gate.
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1" || url.searchParams.get("action") === "send_now";
    const digest = force
      ? await (await import("@/lib/telegram/reports")).sendDigestNow({ force: true, skipIdempotency: true })
      : await maybeRunScheduledDigest();
    const [overdue, noLeads, webinar24h] = await Promise.all([
      alertOverdueInstallments().catch(() => ({ sent: 0 })),
      alertNoLeadsIfStale().catch(() => false),
      alertWebinarReminders24h().catch(() => 0),
    ]);
    return NextResponse.json({
      ok: true,
      digest,
      alerts: { overdue, noLeads, webinar24h },
      ts: Date.now(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
