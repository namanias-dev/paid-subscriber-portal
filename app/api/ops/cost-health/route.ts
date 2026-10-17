import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { buildCostHealthReport } from "@/lib/cost/costHealth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lightweight cost-guardrail probe for ops/cron.
 * Auth: CRON_SECRET. No heavy DB scans, no media body transfers.
 */
export async function GET(req: Request) {
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(buildCostHealthReport(), {
    headers: { "Cache-Control": "no-store" },
  });
}
