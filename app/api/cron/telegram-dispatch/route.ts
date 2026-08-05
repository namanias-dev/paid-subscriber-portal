import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { hasDueScheduledAutomations, processDueScheduledAutomations } from "@/lib/telegram/automations";
import { drainTelegramQueue, hasDueTelegramQueueWork } from "@/lib/telegram/queue";
import { sweepSalesOutbox } from "@/lib/telegram/sales/deliver";
import { outboxHasDueWork } from "@/lib/telegram/sales/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: Request) {
  const authorized =
    authorizeCron(req, process.env.CRON_SECRET) ||
    authorizeCron(req, process.env.TELEGRAM_WEBHOOK_SECRET);
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Cheap peek before drain/automation/outbox work — most runs are idle.
    const [queueDue, scheduledDue, salesOutboxDue] = await Promise.all([
      hasDueTelegramQueueWork(),
      hasDueScheduledAutomations(),
      outboxHasDueWork(),
    ]);
    if (!queueDue && !scheduledDue && !salesOutboxDue) {
      return NextResponse.json({ ok: true, idle: true, sales_outbox: { due: 0 }, ts: Date.now() });
    }
    const [queue, scheduled, salesOutbox] = await Promise.all([
      queueDue
        ? drainTelegramQueue({ limit: 150 })
        : Promise.resolve({
            processed: 0,
            sent: 0,
            failed: 0,
            blocked: 0,
            skipped: 0,
            paused: 0,
          }),
      scheduledDue ? processDueScheduledAutomations() : Promise.resolve({ ran: 0 }),
      salesOutboxDue ? sweepSalesOutbox(40) : Promise.resolve({ due: 0, sent: 0, failed: 0 }),
    ]);
    return NextResponse.json({ ok: true, queue, scheduled, sales_outbox: salesOutbox, ts: Date.now() });
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
