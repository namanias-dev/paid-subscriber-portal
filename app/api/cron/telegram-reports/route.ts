import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import {
  alertNoLeadsIfStale,
  alertOverdueInstallments,
  alertWebinarReminders24h,
  maybeRunScheduledDigest,
  sendDigestNow,
} from "@/lib/telegram/reports";
import { verifyReportsChannel } from "@/lib/telegram/reports/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function run(req: Request) {
  const authorized =
    authorizeCron(req, process.env.CRON_SECRET) ||
    authorizeCron(req, process.env.TELEGRAM_WEBHOOK_SECRET);
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";
    const force =
      url.searchParams.get("force") === "1" ||
      action === "send_now" ||
      action === "send_digest";

    // Fast path: verify env + getChat + optional one-line test
    if (action === "verify") {
      const verify = await verifyReportsChannel({
        sendTest: url.searchParams.get("test") !== "0",
      });
      return NextResponse.json({ ok: verify.ok, verify, ts: Date.now() });
    }

    if (force || action === "send_morning") {
      // Verify channel first so failures are explicit
      const verify = await verifyReportsChannel({ sendTest: true });
      if (!verify.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: "channel_verify_failed",
            verify,
            ts: Date.now(),
          },
          { status: 502 },
        );
      }
      const digest = await sendDigestNow({
        force: true,
        skipIdempotency: true,
        morningExtras: action === "send_morning" || url.searchParams.get("morning") === "1",
      });
      return NextResponse.json({
        ok: digest.ok,
        verify,
        digest,
        alerts: { overdue: { sent: 0 }, noLeads: false, webinar24h: 0 },
        ts: Date.now(),
      });
    }

    const digest = await maybeRunScheduledDigest();
    const alerts = {
      overdue: await alertOverdueInstallments().catch(() => ({ sent: 0 })),
      noLeads: await alertNoLeadsIfStale().catch(() => false),
      webinar24h: await alertWebinarReminders24h().catch(() => 0),
    };
    return NextResponse.json({ ok: true, digest, alerts, ts: Date.now() });
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
