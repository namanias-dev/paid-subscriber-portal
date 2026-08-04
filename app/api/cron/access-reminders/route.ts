import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { printAutoReport, runAccessAutomation } from "@/lib/sms/accessAutomation";
import { heavyCronHalted } from "@/lib/incidentHalt";
import { dbCircuitOpen, dbCircuitStatus, withDbBudget } from "@/lib/dbCircuit";
import { getRule, touchRuleLastRun } from "@/lib/sms/store";
import { istMinutesOfDay } from "@/lib/sms/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Access At Risk automation tick — gated by Mission Control rule
 * `installment_access_reminder` (enabled + schedule_time). Defaults send nothing.
 * Same scanner as sms-dispatch; this cron is the 11:00 IST dedicated slot.
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

  const rule = await getRule("installment_access_reminder");
  // MC rule is the kill/arm switch. Disabled → plan-only dry report if settings.dryRun.
  if (rule && !rule.enabled) {
    return NextResponse.json({
      ok: true,
      armed: false,
      note: "Mission Control installment_access_reminder is OFF — zero sends.",
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
    if (report.sent > 0) touchRuleLastRun("installment_access_reminder");
    return NextResponse.json({
      ok: true,
      missionControl: true,
      scheduleTime: rule?.schedule_time || "11:00",
      istMins: istMinutesOfDay(new Date()),
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
