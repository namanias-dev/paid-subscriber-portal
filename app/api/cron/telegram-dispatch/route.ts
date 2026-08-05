import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { hasDueScheduledAutomations, processDueScheduledAutomations } from "@/lib/telegram/automations";
import { drainTelegramQueue, hasDueTelegramQueueWork } from "@/lib/telegram/queue";
import { deliverSalesAlert, sweepSalesOutbox } from "@/lib/telegram/sales/deliver";
import { drainDueSalesLeadBatch } from "@/lib/telegram/sales/leadBatch";
import { salesLeadBatchingEnabled } from "@/lib/telegram/sales/settings";

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
    const [queueDue, scheduledDue] = await Promise.all([
      hasDueTelegramQueueWork(),
      hasDueScheduledAutomations(),
    ]);
    // Always sweep sales outbox (purge pre-cutoff first; no-op send when empty).
    const salesOutbox = await sweepSalesOutbox(40);

    // Lead batch flush — only when SALES_LEAD_BATCHING=1 (shipped OFF).
    let leadBatch = { flushed: 0 };
    if (salesLeadBatchingEnabled()) {
      const items = await drainDueSalesLeadBatch(40);
      for (const item of items) {
        const r = await deliverSalesAlert({
          eventId: item.eventId,
          event: "new_lead",
          phone: item.phone,
          html: item.html,
          buttons: item.buttons,
          occurredAt: item.queuedAt,
        });
        if (r === "sent") leadBatch.flushed++;
      }
    }

    if (!queueDue && !scheduledDue && salesOutbox.due === 0 && leadBatch.flushed === 0) {
      return NextResponse.json({
        ok: true,
        idle: true,
        sales_outbox: salesOutbox,
        lead_batch: leadBatch,
        ts: Date.now(),
      });
    }

    const [queue, scheduled] = await Promise.all([
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
    ]);
    return NextResponse.json({
      ok: true,
      queue,
      scheduled,
      sales_outbox: salesOutbox,
      lead_batch: leadBatch,
      ts: Date.now(),
    });
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
