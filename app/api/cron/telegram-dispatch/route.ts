import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { hasDueScheduledAutomations, processDueScheduledAutomations } from "@/lib/telegram/automations";
import { drainTelegramQueue, hasDueTelegramQueueWork } from "@/lib/telegram/queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: Request) {
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Cheap peek before drain/automation work — most */5 runs are idle.
    const [queueDue, scheduledDue] = await Promise.all([
      hasDueTelegramQueueWork(),
      hasDueScheduledAutomations(),
    ]);
    if (!queueDue && !scheduledDue) {
      return NextResponse.json({ ok: true, idle: true, ts: Date.now() });
    }
    const [queue, scheduled] = await Promise.all([
      queueDue ? drainTelegramQueue({ limit: 150 }) : Promise.resolve({
        processed: 0, sent: 0, failed: 0, blocked: 0, skipped: 0, paused: 0,
      }),
      scheduledDue ? processDueScheduledAutomations() : Promise.resolve({ ran: 0 }),
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
