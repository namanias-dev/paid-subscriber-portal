import { NextResponse } from "next/server";
import { journeyAutomationEnabled } from "@/lib/journey-automation/flags";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { supabaseEnginePort } from "@/lib/journey-automation/engine/supabasePort";
import { realState } from "@/lib/journey-automation/engine/realState";
import { realSender } from "@/lib/journey-automation/engine/realSender";
import { systemClock } from "@/lib/journey-automation/engine/ports";
import { runMatcher } from "@/lib/journey-automation/engine/matcher";
import { runWorker } from "@/lib/journey-automation/engine/worker";
import { heavyCronHalted } from "@/lib/incidentHalt";
import { dbCircuitOpen, dbCircuitStatus } from "@/lib/dbCircuit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: Request) {
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (heavyCronHalted() || dbCircuitOpen()) {
    return NextResponse.json({
      ok: true,
      halted: true,
      reason: heavyCronHalted() ? "sev1_halt" : "db_circuit_open",
      circuit: dbCircuitStatus(),
      ts: Date.now(),
    });
  }
  if (!journeyAutomationEnabled()) {
    return NextResponse.json({ ok: true, skipped: "feature_disabled" });
  }

  try {
    const matcher = await runMatcher(supabaseEnginePort, realState, systemClock, { batchSize: 200 });
    const worker = await runWorker(supabaseEnginePort, realSender, realState, systemClock, { batchSize: 50 });
    return NextResponse.json({ ok: true, matcher, worker, ts: Date.now() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
