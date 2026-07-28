import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { drainDueFollowUps, DRAIN_BATCH_SIZE } from "@/lib/sms/installmentFollowUp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Drains scheduled SMS follow-ups (step 2 of the installment reminder sequence).
 *
 * CADENCE. vercel.json runs this every 2 minutes, so a follow-up due at +30 min
 * goes out between +30 and +32. That is measured, not assumed: this project's
 * plan already runs /api/cron/journey-engine on a five-minute schedule and it
 * fires on the dot, so sub-daily cron is available here and pg_cron was not
 * needed. The scheduling lives in vercel.json alongside the other seven crons
 * rather than in a second scheduler nobody would think to look at.
 *
 * IDEMPOTENT AND OVERLAP-SAFE. Rows are claimed with FOR UPDATE SKIP LOCKED and
 * each send carries a deterministic dedupe key, so running twice at once — or
 * being pinged by hand while the scheduler also fires — sends each follow-up
 * exactly once. An empty queue costs one indexed query, so a high frequency is
 * cheap.
 *
 * SECURITY. CRON_SECRET is REQUIRED and the check fails closed: this route
 * sends real messages, so an open endpoint is not acceptable. Vercel's scheduler
 * sends it as `Authorization: Bearer <CRON_SECRET>`.
 */
async function run(req: Request) {
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
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
