/**
 * Dedup / rate-limit queue for sales Telegram.
 * Sales & Admissions has NO quiet hours — instant alerts always deliver.
 * Reuses telegram_report_snapshots (slot_key unique) — no new migration.
 */
import { getSupabaseAdmin } from "../../supabase";
import { istNowParts } from "../reports/format";

export type SalesEventType =
  | "payment_failed"
  | "checkout_abandoned"
  | "payment_link_expired"
  | "installment_proof_uploaded"
  | "webinar_proof_uploaded"
  | "admission"
  | "installment_paid"
  | "installment_partial"
  | "payment_succeeded"
  | "webinar_registration"
  | "webinar_payment"
  | "new_lead"
  | "prove_transport";

/** No rate limit on Sales & Admissions — always allow (kept for legacy queue drain). */
const RATE_LIMIT_PER_MIN = Number.POSITIVE_INFINITY;

/** Always false — Sales channel stays live 24×7 (kept for callers/tests). */
export function inSalesQuietHours(_d = new Date()): boolean {
  return false;
}

function phoneKey(phone: string): string {
  return String(phone || "").replace(/\D/g, "").slice(-10) || "unknown";
}

export function salesDedupKey(event: SalesEventType, phone: string, ymd?: string): string {
  const day = ymd || istNowParts().ymd;
  return `sales:dedupe:${event}:${phoneKey(phone)}:${day}`;
}

/** One alert per student+event per 24h IST day. Returns true if already sent. */
export async function alreadyDeduped(event: SalesEventType, phone: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const key = salesDedupKey(event, phone);
  try {
    const { data } = await db.from("telegram_report_snapshots").select("id").eq("slot_key", key).maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

export async function markDeduped(
  event: SalesEventType,
  phone: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const key = salesDedupKey(event, phone);
  await db
    .from("telegram_report_snapshots")
    .upsert(
      {
        slot_key: key,
        kind: "sales_dedupe",
        metrics: { event, phone: phoneKey(phone), ...(metadata || {}) },
      },
      { onConflict: "slot_key" },
    )
    .then(
      () => null,
      () => null,
    );
}

/** Returns true if under rate limit (and increments). False → overflow.
 * Sales channel: always true (no rate limiting). */
export async function tryConsumeRateSlot(): Promise<boolean> {
  return true;
}

export interface QueuedSalesAlert {
  event: SalesEventType;
  phone: string;
  html: string;
  buttons: { label: string; url: string }[];
  queuedAt: string;
  reason: "rate" | "quiet"; // "quiet" retained for any legacy queued rows
}

export async function enqueueSalesAlert(item: QueuedSalesAlert): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const key = `sales:queue:${id}`;
  await db
    .from("telegram_report_snapshots")
    .upsert(
      {
        slot_key: key,
        kind: "sales_queue",
        metrics: item as unknown as Record<string, unknown>,
      },
      { onConflict: "slot_key" },
    )
    .then(
      () => null,
      () => null,
    );
}

export async function drainSalesQueue(): Promise<QueuedSalesAlert[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  try {
    const { data } = await db
      .from("telegram_report_snapshots")
      .select("slot_key,metrics")
      .eq("kind", "sales_queue")
      .order("created_at", { ascending: true })
      .limit(100);
    const rows = data || [];
    const out: QueuedSalesAlert[] = [];
    for (const r of rows) {
      const m = r.metrics as QueuedSalesAlert | null;
      if (m?.html && m?.event) out.push(m);
      await db.from("telegram_report_snapshots").delete().eq("slot_key", r.slot_key);
    }
    return out;
  } catch {
    return [];
  }
}

export { RATE_LIMIT_PER_MIN };
