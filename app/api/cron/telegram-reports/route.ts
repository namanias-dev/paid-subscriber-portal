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
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const digest = await maybeRunScheduledDigest();
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
