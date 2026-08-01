import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { processDueScheduledAutomations } from "@/lib/telegram/automations";
import { drainTelegramQueue } from "@/lib/telegram/queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: Request) {
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [queue, scheduled] = await Promise.all([
      drainTelegramQueue({ limit: 150 }),
      processDueScheduledAutomations(),
    ]);
    return NextResponse.json({ ok: true, queue, scheduled, ts: Date.now() });
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
