import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { printAutoReport, runAccessAutomation } from "@/lib/sms/accessAutomation";
import { heavyCronHalted } from "@/lib/incidentHalt";
import { dbCircuitOpen, dbCircuitStatus, withDbBudget } from "@/lib/dbCircuit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Access At Risk automation tick. Defaults: dry-run ON, enabled OFF, kill
 * switch OFF — so this cron is safe to ship. It logs would-send / excluded
 * tables and sends nothing until settings are flipped.
 *
 * SEV1: hard-halted while public-site DB pressure is unresolved.
 */
async function run(req: Request) {
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (heavyCronHalted()) {
    return NextResponse.json({
      ok: true, halted: true, reason: "sev1_halt",
      note: "Heavy crons paused — public site restoration in progress. Zero SMS.",
      circuit: dbCircuitStatus(),
      ts: Date.now(),
    });
  }
  if (dbCircuitOpen()) {
    return NextResponse.json({
      ok: true, halted: true, reason: "db_circuit_open",
      circuit: dbCircuitStatus(),
      ts: Date.now(),
    });
  }
  try {
    const raced = await withDbBudget(runAccessAutomation(), 25_000, "access_automation");
    if (!raced.ok) {
      return NextResponse.json({
        ok: false, error: raced.error, circuit: dbCircuitStatus(), ts: Date.now(),
      }, { status: 503 });
    }
    const report = raced.value;
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
      circuit: dbCircuitStatus(),
      ts: Date.now(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
