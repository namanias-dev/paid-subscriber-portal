/**
 * Sales Telegram outbox — durable retry for failed/pending instant alerts.
 * Stored in telegram_report_snapshots (kind=sales_outbox) — no new table.
 * Dedup key = eventId (unique per logical event).
 */
import { getSupabaseAdmin } from "../../supabase";
import { tgLog } from "../log";

export type SalesOutboxStatus = "pending" | "sent" | "failed";

export interface SalesOutboxRow {
  eventId: string;
  event: string;
  phone: string;
  html: string;
  buttons: { label: string; url: string }[];
  status: SalesOutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

function slotKey(eventId: string): string {
  return `sales:outbox:${eventId}`;
}

export async function outboxGet(eventId: string): Promise<SalesOutboxRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  try {
    const { data } = await db
      .from("telegram_report_snapshots")
      .select("metrics")
      .eq("slot_key", slotKey(eventId))
      .maybeSingle();
    return (data?.metrics as SalesOutboxRow | null) || null;
  } catch {
    return null;
  }
}

export async function outboxUpsert(row: SalesOutboxRow): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db
    .from("telegram_report_snapshots")
    .upsert(
      {
        slot_key: slotKey(row.eventId),
        kind: "sales_outbox",
        metrics: row as unknown as Record<string, unknown>,
      },
      { onConflict: "slot_key" },
    )
    .then(
      () => null,
      (e) => {
        tgLog("sales_outbox_upsert_failed", { error: (e as Error).message, eventId: row.eventId }, "error");
      },
    );
}

/** True if this eventId already sent (dedupe). */
export async function outboxAlreadySent(eventId: string): Promise<boolean> {
  const row = await outboxGet(eventId);
  return row?.status === "sent";
}

export async function outboxMarkSent(eventId: string, messageId: number | null): Promise<void> {
  const prev = (await outboxGet(eventId)) || null;
  const now = new Date().toISOString();
  await outboxUpsert({
    eventId,
    event: prev?.event || "unknown",
    phone: prev?.phone || "",
    html: prev?.html || "",
    buttons: prev?.buttons || [],
    status: "sent",
    attempts: prev?.attempts || 0,
    lastError: null,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
    ...(messageId != null ? { messageId } as unknown as object : {}),
  });
}

export async function outboxListDue(limit = 50): Promise<SalesOutboxRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  try {
    const { data } = await db
      .from("telegram_report_snapshots")
      .select("metrics")
      .eq("kind", "sales_outbox")
      .order("created_at", { ascending: true })
      .limit(200);
    const rows = (data || [])
      .map((r) => r.metrics as SalesOutboxRow | null)
      .filter((m): m is SalesOutboxRow => !!m?.eventId && !!m?.html)
      .filter((m) => m.status === "pending" || m.status === "failed")
      .filter((m) => (m.attempts || 0) < 10);
    return rows.slice(0, limit);
  } catch {
    return [];
  }
}

export async function outboxHasDueWork(): Promise<boolean> {
  const due = await outboxListDue(1);
  return due.length > 0;
}
