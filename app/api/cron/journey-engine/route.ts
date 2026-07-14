import { NextResponse } from "next/server";
import { journeyAutomationEnabled } from "@/lib/journey-automation/flags";
import { supabaseEnginePort } from "@/lib/journey-automation/engine/supabasePort";
import { realState } from "@/lib/journey-automation/engine/realState";
import { realSender } from "@/lib/journey-automation/engine/realSender";
import { systemClock } from "@/lib/journey-automation/engine/ports";
import { runMatcher } from "@/lib/journey-automation/engine/matcher";
import { runWorker } from "@/lib/journey-automation/engine/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Journey Automation execution tick. ADDITIVE cron. Two phases:
 *   1. matcher — drain new automation_events → enroll eligible contacts (idempotent)
 *   2. worker  — execute due jobs (one node per job) with latest-state revalidation
 *
 * SAFE BY DEFAULT: every workflow ships at execution_mode='off', so the matcher
 * enrolls nobody and the worker has nothing to do — this is a no-op until a human
 * moves a workflow to 'simulate' (dry soak) or 'live'. Even 'live' only SENDS when
 * the env flags (EXECUTION+SMS + category) are on and the kill switch is clear;
 * otherwise the SMS adapter records a would-send and sends NOTHING.
 *
 * Vercel cron (daily) keeps it warm; for tighter cadence point an external
 * scheduler at it (all writes idempotent, so extra pings are safe):
 *   GET /api/cron/journey-engine?secret=<CRON_SECRET>
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // Master feature gate: if the whole feature is off, do nothing.
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
