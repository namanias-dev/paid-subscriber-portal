/**
 * Identify + purge Sales prove/fixture Telegram messages.
 * Never touches digests, seed rows, or real alerts.
 */
import { getSupabaseAdmin } from "../../supabase";
import { deleteMessage } from "../botApi";
import { tgLog } from "../log";

export const FIXTURE_PHONE_TAIL = "9898900199";

export function isSalesFixturePayload(input: {
  eventId?: string | null;
  event?: string | null;
  phone?: string | null;
  html?: string | null;
  synthetic?: boolean | null;
}): boolean {
  if (input.synthetic) return true;
  const eventId = String(input.eventId || "");
  if (eventId.startsWith("prove:") || eventId.startsWith("fixture:")) return true;
  if (String(input.event || "") === "prove_transport") return true;
  const phone = String(input.phone || "").replace(/\D/g, "").slice(-10);
  if (phone === FIXTURE_PHONE_TAIL) return true;
  const html = String(input.html || "");
  if (/Sales Prove Fixture|prove_fixture|PROVE-RCPT|Prove Webinar|Prove Course|Sales prove transport/i.test(html)) {
    return true;
  }
  return false;
}

export type FixtureOutboxRow = {
  slotKey: string;
  eventId: string;
  event: string;
  messageId: number | null;
  status: string;
  html: string;
  phone: string;
  createdAt: string;
};

export async function listFixtureSalesOutbox(): Promise<FixtureOutboxRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("telegram_report_snapshots")
    .select("slot_key,metrics,created_at")
    .eq("kind", "sales_outbox")
    .limit(500);
  const out: FixtureOutboxRow[] = [];
  for (const r of data || []) {
    const m = r.metrics as Record<string, unknown> | null;
    if (!m) continue;
    const eventId = String(m.eventId || "");
    const html = String(m.html || "");
    const phone = String(m.phone || "");
    if (
      !isSalesFixturePayload({
        eventId,
        event: String(m.event || ""),
        phone,
        html,
      })
    ) {
      continue;
    }
    const midRaw = m.messageId;
    const messageId =
      typeof midRaw === "number"
        ? midRaw
        : midRaw != null && Number.isFinite(Number(midRaw))
          ? Number(midRaw)
          : null;
    out.push({
      slotKey: r.slot_key,
      eventId,
      event: String(m.event || ""),
      messageId,
      status: String(m.status || ""),
      html,
      phone,
      createdAt: (r as { created_at?: string }).created_at || String(m.createdAt || ""),
    });
  }
  return out.sort((a, b) => (a.messageId || 0) - (b.messageId || 0));
}

export type DeleteFixtureResult = {
  messageId: number;
  eventId: string;
  htmlPreview: string;
  result: "deleted" | "already_gone" | "failed" | "out_of_window" | "no_message_id";
  error?: string;
};

/** List intended deletes (with text), then delete each fixture message in the sales chat. */
export async function purgeFixtureSalesMessages(): Promise<{
  intended: { messageId: number; eventId: string; html: string }[];
  results: DeleteFixtureResult[];
  outboxPurged: number;
  summary: { deleted: number; already_gone: number; failed: number; out_of_window: number; no_message_id: number };
}> {
  const chatId = (process.env.TELEGRAM_SALES_CHAT_ID || "").trim();
  const rows = await listFixtureSalesOutbox();
  const intended = rows
    .filter((r) => r.messageId != null)
    .map((r) => ({
      messageId: r.messageId!,
      eventId: r.eventId,
      html: r.html,
    }));

  // Print-ready list is returned before deletes complete; we delete in this same call.
  const results: DeleteFixtureResult[] = [];
  const seenMids = new Set<number>();

  for (const row of rows) {
    if (row.messageId == null) {
      results.push({
        messageId: 0,
        eventId: row.eventId,
        htmlPreview: row.html.slice(0, 120),
        result: "no_message_id",
      });
      continue;
    }
    if (seenMids.has(row.messageId)) continue;
    seenMids.add(row.messageId);

    if (!chatId) {
      results.push({
        messageId: row.messageId,
        eventId: row.eventId,
        htmlPreview: row.html.slice(0, 120),
        result: "failed",
        error: "sales_chat_unset",
      });
      continue;
    }

    const res = await deleteMessage(chatId, row.messageId);
    const desc = (res.description || "").toLowerCase();
    let result: DeleteFixtureResult["result"] = "failed";
    if (res.ok) result = "deleted";
    else if (desc.includes("message to delete not found") || desc.includes("message can't be deleted")) {
      // "message can't be deleted" often = already gone OR too old — distinguish age
      const ageMs = Date.now() - Date.parse(row.createdAt);
      if (Number.isFinite(ageMs) && ageMs > 48 * 3600_000) result = "out_of_window";
      else if (desc.includes("not found")) result = "already_gone";
      else if (desc.includes("can't be deleted") || desc.includes("can't delete")) {
        // Telegram: messages older than 48h in channels/supergroups
        result = ageMs > 40 * 3600_000 ? "out_of_window" : "already_gone";
      } else result = "already_gone";
    } else if (desc.includes("too old") || desc.includes("48")) {
      result = "out_of_window";
    }
    results.push({
      messageId: row.messageId,
      eventId: row.eventId,
      htmlPreview: row.html.slice(0, 160),
      result,
      error: res.ok ? undefined : res.description,
    });
    tgLog(
      "sales_fixture_delete",
      { messageId: row.messageId, eventId: row.eventId, result, error: res.description },
      res.ok ? "info" : "warn",
    );
  }

  const outboxPurged = await purgeFixtureOutboxRows(rows.map((r) => r.slotKey));

  const summary = {
    deleted: results.filter((r) => r.result === "deleted").length,
    already_gone: results.filter((r) => r.result === "already_gone").length,
    failed: results.filter((r) => r.result === "failed").length,
    out_of_window: results.filter((r) => r.result === "out_of_window").length,
    no_message_id: results.filter((r) => r.result === "no_message_id").length,
  };

  return { intended, results, outboxPurged, summary };
}

async function purgeFixtureOutboxRows(slotKeys: string[]): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db || !slotKeys.length) return 0;
  let n = 0;
  for (const key of slotKeys) {
    const { error } = await db.from("telegram_report_snapshots").delete().eq("slot_key", key);
    if (!error) n++;
  }
  return n;
}
