/**
 * Lead batching queue — only used when SALES_LEAD_BATCHING=1.
 * Default is OFF; this module is inert while the flag is off.
 * Payments and proofs never enter this path.
 */
import { getSupabaseAdmin } from "../../supabase";
import { tgLog } from "../log";
import { salesLeadBatchIntervalMinutes } from "./settings";

export type BatchedLead = {
  name: string;
  phone: string;
  source?: string | null;
  courseInterest?: string | null;
  leadId?: string | null;
  eventId: string;
  html: string;
  buttons: { label: string; url: string }[];
  queuedAt: string;
};

function batchSlotKey(eventId: string): string {
  return `sales:lead_batch:${eventId}`;
}

/** Enqueue a lead for later flush (batching ON only). */
export async function enqueueSalesLeadBatch(item: BatchedLead): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db
    .from("telegram_report_snapshots")
    .upsert(
      {
        slot_key: batchSlotKey(item.eventId),
        kind: "sales_lead_batch",
        metrics: {
          ...item,
          flushAfterIso: new Date(
            Date.now() + salesLeadBatchIntervalMinutes() * 60_000,
          ).toISOString(),
        },
      },
      { onConflict: "slot_key" },
    )
    .then(
      () => {
        tgLog("sales_lead_batched", { eventId: item.eventId, phone: item.phone }, "info");
      },
      (e) => {
        tgLog("sales_lead_batch_enqueue_failed", { error: (e as Error).message }, "error");
      },
    );
}

/** Drain due batched leads. Caller must gate on salesLeadBatchingEnabled(). */
export async function drainDueSalesLeadBatch(limit = 40): Promise<BatchedLead[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const now = Date.now();
  try {
    const { data } = await db
      .from("telegram_report_snapshots")
      .select("slot_key,metrics")
      .eq("kind", "sales_lead_batch")
      .order("created_at", { ascending: true })
      .limit(100);
    const out: BatchedLead[] = [];
    for (const r of data || []) {
      if (out.length >= limit) break;
      const m = r.metrics as (BatchedLead & { flushAfterIso?: string }) | null;
      if (!m?.html || !m?.eventId) continue;
      const due = !m.flushAfterIso || Date.parse(m.flushAfterIso) <= now;
      if (!due) continue;
      out.push(m);
      await db.from("telegram_report_snapshots").delete().eq("slot_key", r.slot_key);
    }
    return out;
  } catch {
    return [];
  }
}
