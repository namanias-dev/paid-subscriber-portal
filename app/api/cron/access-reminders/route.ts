import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { printAutoReport, runAccessAutomation } from "@/lib/sms/accessAutomation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Access At Risk automation tick. Defaults: dry-run ON, enabled OFF, kill
 * switch OFF — so this cron is safe to ship. It logs would-send / excluded
 * tables and sends nothing until settings are flipped.
 */
async function run(req: Request) {
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const report = await runAccessAutomation();
    printAutoReport(report);
    return NextResponse.json({
      ok: true,
      dryRun: report.dryRun,
      enabled: report.settings.enabled,
      killSwitch: report.settings.killSwitch,
      wouldSend: report.wouldSend.length,
      sent: report.sent,
      excluded: report.excluded,
      seatBookingOnly: report.seatBookingOnly,
      haltedReason: report.haltedReason,
      ts: Date.now(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
