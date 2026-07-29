import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { drainDueFollowUps, DRAIN_BATCH_SIZE } from "@/lib/sms/installmentFollowUp";
import { heavyCronHalted } from "@/lib/incidentHalt";
import { dbCircuitOpen, dbCircuitStatus } from "@/lib/dbCircuit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Drains scheduled SMS follow-ups (step 2 of the installment reminder sequence).
 * SEV1: hard-halted while public-site DB pressure is unresolved.
 */
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
  try {
    const result = await drainDueFollowUps({ limit: DRAIN_BATCH_SIZE });
    return NextResponse.json({ ok: true, ...result, ts: Date.now() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
