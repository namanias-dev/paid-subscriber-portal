/**
 * Real-time Telegram alert for a newly paid Notes Store order.
 *
 * Fires only after the order row is committed. Telegram failures stay in this
 * module: they never throw into payment verification. Idempotency is one
 * telegram_report_snapshots row per order (`notes_order_paid:<orderId>`).
 * Destination is the existing executive-brief channel. The sales outbox pattern
 * (claim, retry, never block the caller) is reused; the sales phone-day dedupe
 * key is not, because two Notes orders from one customer on the same day are
 * two sales.
 */
import { waitUntil } from "@vercel/functions";
import { sendMessage } from "./botApi";
import { tgLog } from "./log";
import { getSupabaseAdmin } from "../supabase";
import { storeDb } from "../store/db";
import { assertReportsChannel } from "./reports/channelGuard";
import { getReportSettings, maskChannelId, resolveReportsChannelId } from "./reports/settings";
import {
  NOTES_ORDER_ALERT_EVENT,
  NOTES_ORDER_ALERT_GRACE_MS,
  formatNotesOrderAlertHtml,
  isAlertQualifyingOrder,
  isAlertTestOrder,
  notesOrderPaidSlot,
  notesOrdersNeedingAlert,
  notesOrdersNeedingBaselineSkip,
  notesPaidAlertCounts,
  type NotesAlertOrder,
} from "./notesOrderAlertFormat";

export { shouldFireNotesPaidAlert } from "./notesOrderAlertFormat";

const CUTOFF_SLOT = "notes_order_alerts_cutoff";
const KIND = "notes_order_outbox";
const LEASE_MS = 90_000;
const MAX_ATTEMPTS = 10;
const DEFAULT_BACKOFFS = [0, 400, 1200];

export interface NotesPaidAlertInput {
  orderId: string;
  orderNo: string | null;
  amountPaise: number;
  paidAt: string;
}

export type NotesAlertResult = "sent" | "duplicate" | "skipped" | "failed" | "busy";

interface NotesOutboxRow {
  orderId: string;
  orderNo: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  lastError: string | null;
  messageId: number | null;
  html: string | null;
  amountPaise: number | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

interface AlertDeps {
  getOutbox: (orderId: string) => Promise<NotesOutboxRow | null>;
  saveOutbox: (row: NotesOutboxRow) => Promise<void>;
  loadOrders: () => Promise<NotesAlertOrder[] | null>;
  readCutoff: () => Promise<string | null>;
  insertCutoff: (iso: string) => Promise<boolean>;
  send: (html: string) => Promise<{ ok: boolean; messageId: number | null; error: string | null }>;
  sleep: (ms: number) => Promise<void>;
  backoffs: number[];
  now: () => number;
}

function emptyRow(input: NotesPaidAlertInput, nowIso: string): NotesOutboxRow {
  return {
    orderId: input.orderId,
    orderNo: input.orderNo,
    status: "pending",
    attempts: 0,
    lastError: null,
    messageId: null,
    html: null,
    amountPaise: input.amountPaise,
    paidAt: input.paidAt,
    createdAt: nowIso,
    updatedAt: nowIso,
    sentAt: null,
  };
}

async function claim(
  input: NotesPaidAlertInput,
  deps: AlertDeps,
): Promise<{ state: "owner" | "duplicate" | "skipped" | "busy" | "exhausted"; row: NotesOutboxRow }> {
  const existing = await deps.getOutbox(input.orderId);
  const nowIso = new Date(deps.now()).toISOString();
  if (existing?.status === "sent") return { state: "duplicate", row: existing };
  if (existing?.status === "skipped") return { state: "skipped", row: existing };
  if (existing && existing.attempts >= MAX_ATTEMPTS) return { state: "exhausted", row: existing };
  if (existing?.status === "pending") {
    const age = deps.now() - Date.parse(existing.updatedAt);
    if (Number.isFinite(age) && age >= 0 && age < LEASE_MS) return { state: "busy", row: existing };
  }
  const row: NotesOutboxRow = existing
    ? {
        ...existing,
        orderNo: existing.orderNo || input.orderNo,
        amountPaise: existing.amountPaise ?? input.amountPaise,
        paidAt: existing.paidAt || input.paidAt,
        status: "pending",
        updatedAt: nowIso,
        lastError: null,
      }
    : emptyRow(input, nowIso);
  await deps.saveOutbox(row);
  return { state: "owner", row };
}

async function ensureBaseline(deps: AlertDeps): Promise<number> {
  let cutoffIso = await deps.readCutoff();
  if (!cutoffIso) {
    const proposed = new Date(deps.now()).toISOString();
    const won = await deps.insertCutoff(proposed);
    cutoffIso = won ? proposed : (await deps.readCutoff()) || proposed;
  }
  const cutoffMs = Date.parse(cutoffIso);
  if (!Number.isFinite(cutoffMs)) return 0;
  const orders = await deps.loadOrders();
  if (!orders) return 0;
  const ids = notesOrdersNeedingBaselineSkip(orders, cutoffMs, NOTES_ORDER_ALERT_GRACE_MS);
  let marked = 0;
  for (const orderId of ids) {
    const existing = await deps.getOutbox(orderId);
    if (existing) continue;
    const order = orders.find((row) => row.id === orderId);
    const nowIso = new Date(deps.now()).toISOString();
    await deps.saveOutbox({
      orderId,
      orderNo: order?.orderNo || null,
      status: "skipped",
      attempts: 0,
      lastError: "pre_existing",
      messageId: null,
      html: null,
      amountPaise: null,
      paidAt: order?.paidAt || null,
      createdAt: nowIso,
      updatedAt: nowIso,
      sentAt: null,
    });
    marked += 1;
    tgLog("notes_order_alert_baseline", { orderId, event: NOTES_ORDER_ALERT_EVENT, result: "pre_existing" }, "info");
  }
  return marked;
}

export async function deliverNotesOrderPaidAlert(input: NotesPaidAlertInput, override?: Partial<AlertDeps>): Promise<NotesAlertResult> {
  const deps = override ? { ...defaultDeps(), ...override } : defaultDeps();
  try {
    tgLog(
      "notes_order_paid_detected",
      { orderId: input.orderId, orderNo: input.orderNo, event: NOTES_ORDER_ALERT_EVENT },
      "info",
    );
    const claimed = await claim(input, deps);
    if (claimed.state !== "owner") {
      const result = claimed.state === "exhausted" ? "failed" : claimed.state;
      tgLog(
        "notes_order_alert_duplicate",
        { orderId: input.orderId, event: NOTES_ORDER_ALERT_EVENT, result: claimed.state },
        "info",
      );
      return result;
    }

    try {
      await ensureBaseline(deps);
    } catch (error) {
      tgLog("notes_order_alert_baseline_failed", { orderId: input.orderId, error: (error as Error).message }, "error");
    }

    const again = await deps.getOutbox(input.orderId);
    if (again?.status === "skipped" || again?.status === "sent") {
      tgLog("notes_order_alert_duplicate", { orderId: input.orderId, event: NOTES_ORDER_ALERT_EVENT, result: again.status }, "info");
      return again.status === "sent" ? "duplicate" : "skipped";
    }

    const cutoffIso = await deps.readCutoff();
    const cutoffMs = cutoffIso ? Date.parse(cutoffIso) : Number.NaN;
    const paidMs = Date.parse(input.paidAt);
    if (Number.isFinite(cutoffMs) && Number.isFinite(paidMs) && paidMs < cutoffMs - NOTES_ORDER_ALERT_GRACE_MS) {
      await deps.saveOutbox({
        ...claimed.row,
        status: "skipped",
        lastError: "pre_existing",
        updatedAt: new Date(deps.now()).toISOString(),
      });
      tgLog("notes_order_alert_skipped", { orderId: input.orderId, event: NOTES_ORDER_ALERT_EVENT, result: "pre_existing" }, "info");
      return "skipped";
    }

    const orders = await deps.loadOrders();
    const self = orders?.find((order) => order.id === input.orderId) || null;
    if (self && isAlertTestOrder(self)) {
      await deps.saveOutbox({
        ...claimed.row,
        status: "skipped",
        lastError: "test_order",
        updatedAt: new Date(deps.now()).toISOString(),
      });
      tgLog("notes_order_alert_skipped", { orderId: input.orderId, event: NOTES_ORDER_ALERT_EVENT, result: "test_order" }, "info");
      return "skipped";
    }
    if (!orders) {
      await deps.saveOutbox({
        ...claimed.row,
        status: "failed",
        attempts: claimed.row.attempts + 1,
        lastError: "orders_unreadable",
        updatedAt: new Date(deps.now()).toISOString(),
      });
      tgLog("notes_order_alert_failed", { orderId: input.orderId, event: NOTES_ORDER_ALERT_EVENT, result: "orders_unreadable" }, "error");
      return "failed";
    }

    const paidAt = input.paidAt || self?.paidAt || new Date(deps.now()).toISOString();
    const counts = notesPaidAlertCounts(orders, input.orderId, paidAt);
    const items = self?.items?.length ? self.items : [];
    const html =
      again?.html ||
      claimed.row.html ||
      formatNotesOrderAlertHtml({
        orderNo: input.orderNo || self?.orderNo || "",
        sequence: counts.sequence,
        items,
        paidPaise: input.amountPaise,
        paidAt,
        todayCount: counts.today,
        totalCount: counts.total,
      });

    let attempts = claimed.row.attempts;
    let lastError: string | null = null;
    const pending: NotesOutboxRow = {
      ...claimed.row,
      orderNo: input.orderNo || self?.orderNo || claimed.row.orderNo,
      html,
      amountPaise: input.amountPaise,
      paidAt,
      status: "pending",
      updatedAt: new Date(deps.now()).toISOString(),
    };
    await deps.saveOutbox(pending);

    for (const wait of deps.backoffs) {
      if (wait > 0) await deps.sleep(wait);
      attempts += 1;
      tgLog(
        "notes_order_alert_attempt",
        { orderId: input.orderId, orderNo: pending.orderNo, event: NOTES_ORDER_ALERT_EVENT, attempt: attempts },
        "info",
      );
      const res = await deps.send(html).catch((error) => ({
        ok: false as const,
        messageId: null,
        error: (error as Error).message || "send_threw",
      }));
      if (res.ok) {
        const sentAt = new Date(deps.now()).toISOString();
        await deps.saveOutbox({
          ...pending,
          status: "sent",
          attempts,
          lastError: null,
          messageId: res.messageId,
          updatedAt: sentAt,
          sentAt,
        });
        tgLog(
          "notes_order_alert_sent",
          {
            orderId: input.orderId,
            orderNo: pending.orderNo,
            event: NOTES_ORDER_ALERT_EVENT,
            result: "sent",
            messageId: res.messageId,
            attempt: attempts,
          },
          "info",
        );
        return "sent";
      }
      lastError = res.error || "send_failed";
      tgLog(
        "notes_order_alert_failed",
        { orderId: input.orderId, event: NOTES_ORDER_ALERT_EVENT, result: "send_failed", attempt: attempts, error: lastError },
        "error",
      );
    }

    await deps.saveOutbox({
      ...pending,
      status: "failed",
      attempts,
      lastError,
      updatedAt: new Date(deps.now()).toISOString(),
    });
    return "failed";
  } catch (error) {
    tgLog(
      "notes_order_alert_failed",
      { orderId: input.orderId, event: NOTES_ORDER_ALERT_EVENT, result: "exception", error: (error as Error).message },
      "error",
    );
    return "failed";
  }
}

export function fireNotesOrderPaidAlert(input: NotesPaidAlertInput): void {
  const run = async () => {
    try {
      await deliverNotesOrderPaidAlert(input);
    } catch (error) {
      tgLog(
        "notes_order_alert_failed",
        { orderId: input.orderId, event: NOTES_ORDER_ALERT_EVENT, result: "exception", error: (error as Error).message },
        "error",
      );
    }
  };
  try {
    waitUntil(run());
  } catch {
    void run();
  }
}

export async function sweepNotesOrderOutbox(limit = 20): Promise<{ due: number; sent: number; failed: number; baselined: number }> {
  const deps = defaultDeps();
  let baselined = 0;
  try {
    baselined = await ensureBaseline(deps);
  } catch (error) {
    tgLog("notes_order_alert_baseline_failed", { error: (error as Error).message }, "error");
  }
  const orders = await deps.loadOrders();
  if (!orders) return { due: 0, sent: 0, failed: 0, baselined };
  const cutoffIso = await deps.readCutoff();
  const cutoffMs = cutoffIso ? Date.parse(cutoffIso) : deps.now();
  const outbox = new Map<string, string>();
  for (const order of orders) {
    const row = await deps.getOutbox(order.id);
    if (!row) continue;
    if (row.status === "failed" && row.attempts >= MAX_ATTEMPTS) outbox.set(order.id, "skipped");
    else outbox.set(order.id, row.status);
  }
  const ids = notesOrdersNeedingAlert(orders, outbox, cutoffMs).slice(0, limit);
  let sent = 0;
  let failed = 0;
  for (const orderId of ids) {
    const order = orders.find((row) => row.id === orderId);
    if (!order || !isAlertQualifyingOrder(order)) continue;
    const result = await deliverNotesOrderPaidAlert({
      orderId,
      orderNo: order.orderNo,
      amountPaise: order.amountPaidPaise ?? 0,
      paidAt: order.paidAt || new Date(deps.now()).toISOString(),
    });
    if (result === "sent") sent += 1;
    else if (result === "failed") failed += 1;
  }

  const failedRows = await listFailedOutbox(limit);
  for (const row of failedRows) {
    if (ids.includes(row.orderId)) continue;
    const result = await deliverNotesOrderPaidAlert({
      orderId: row.orderId,
      orderNo: row.orderNo,
      amountPaise: row.amountPaise ?? 0,
      paidAt: row.paidAt || new Date(deps.now()).toISOString(),
    });
    if (result === "sent") sent += 1;
    else if (result === "failed") failed += 1;
  }

  return { due: ids.length + failedRows.length, sent, failed, baselined };
}

function defaultDeps(): AlertDeps {
  return {
    getOutbox: productionGetOutbox,
    saveOutbox: productionSaveOutbox,
    loadOrders: productionLoadOrders,
    readCutoff: productionReadCutoff,
    insertCutoff: productionInsertCutoff,
    send: productionSend,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    backoffs: DEFAULT_BACKOFFS,
    now: () => Date.now(),
  };
}

function metricsOf(row: NotesOutboxRow): Record<string, string | number | null> {
  return {
    event: NOTES_ORDER_ALERT_EVENT,
    order_id: row.orderId,
    order_no: row.orderNo,
    status: row.status,
    attempts: row.attempts,
    last_error: row.lastError,
    message_id: row.messageId,
    amount_paise: row.amountPaise,
    paid_at: row.paidAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    sent_at: row.sentAt,
  };
}

function rowFromMetrics(orderId: string, metrics: Record<string, unknown> | null, html: string | null): NotesOutboxRow | null {
  if (!metrics) return null;
  const status = metrics.status;
  if (status !== "pending" && status !== "sent" && status !== "failed" && status !== "skipped") return null;
  return {
    orderId: typeof metrics.order_id === "string" ? metrics.order_id : orderId,
    orderNo: typeof metrics.order_no === "string" ? metrics.order_no : null,
    status,
    attempts: Number(metrics.attempts) || 0,
    lastError: typeof metrics.last_error === "string" ? metrics.last_error : null,
    messageId: typeof metrics.message_id === "number" ? metrics.message_id : null,
    html,
    amountPaise: typeof metrics.amount_paise === "number" ? metrics.amount_paise : null,
    paidAt: typeof metrics.paid_at === "string" ? metrics.paid_at : null,
    createdAt: typeof metrics.created_at === "string" ? metrics.created_at : new Date().toISOString(),
    updatedAt: typeof metrics.updated_at === "string" ? metrics.updated_at : new Date().toISOString(),
    sentAt: typeof metrics.sent_at === "string" ? metrics.sent_at : null,
  };
}

async function productionGetOutbox(orderId: string): Promise<NotesOutboxRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db
    .from("telegram_report_snapshots")
    .select("metrics,message_html")
    .eq("slot_key", notesOrderPaidSlot(orderId))
    .maybeSingle();
  if (!data) return null;
  return rowFromMetrics(orderId, (data.metrics as Record<string, unknown> | null) || null, data.message_html ? String(data.message_html) : null);
}

async function productionSaveOutbox(row: NotesOutboxRow): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const { error } = await db.from("telegram_report_snapshots").upsert(
    {
      slot_key: notesOrderPaidSlot(row.orderId),
      kind: KIND,
      metrics: metricsOf(row),
      message_html: row.html,
    },
    { onConflict: "slot_key" },
  );
  if (error) {
    tgLog("notes_order_alert_outbox_failed", { orderId: row.orderId, error: error.message }, "error");
  }
}

async function productionLoadOrders(): Promise<NotesAlertOrder[] | null> {
  const db = storeDb();
  if (!db) return null;
  const { data, error } = await db
    .from("store_orders")
    .select("id,order_no,status,paid_at,amount_paid_paise")
    .not("paid_at", "is", null)
    .limit(2000);
  if (error || !data) return null;
  const rows = data as {
    id: string;
    order_no: string;
    status: string;
    paid_at: string | null;
    amount_paid_paise: number | null;
  }[];
  const ids = rows.map((row) => row.id);
  const items = new Map<string, NotesAlertOrder["items"]>();
  if (ids.length) {
    const itemsRes = await db.from("store_order_items").select("order_id,name_snapshot,sku_snapshot,qty").in("order_id", ids);
    if (itemsRes.error) return null;
    for (const item of (itemsRes.data || []) as { order_id: string; name_snapshot: string; sku_snapshot: string; qty: number }[]) {
      const list = items.get(item.order_id) || [];
      list.push({ name: item.name_snapshot, sku: item.sku_snapshot, qty: item.qty });
      items.set(item.order_id, list);
    }
  }
  return rows.map((row) => ({
    id: row.id,
    orderNo: row.order_no,
    status: row.status,
    paidAt: row.paid_at,
    amountPaidPaise: row.amount_paid_paise,
    items: items.get(row.id) || [],
  }));
}

async function productionReadCutoff(): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("telegram_report_snapshots").select("metrics").eq("slot_key", CUTOFF_SLOT).maybeSingle();
  const iso = (data?.metrics as { cutoffIso?: string } | null)?.cutoffIso;
  return iso && Number.isFinite(Date.parse(iso)) ? iso : null;
}

async function productionInsertCutoff(iso: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { error } = await db.from("telegram_report_snapshots").insert({
    slot_key: CUTOFF_SLOT,
    kind: "notes_order_alert_cutoff",
    metrics: { cutoffIso: iso, graceMs: NOTES_ORDER_ALERT_GRACE_MS, event: NOTES_ORDER_ALERT_EVENT },
  });
  return !error;
}

async function productionSend(html: string): Promise<{ ok: boolean; messageId: number | null; error: string | null }> {
  const settings = await getReportSettings();
  const resolved = resolveReportsChannelId(settings);
  const guarded = await assertReportsChannel(resolved);
  if (!guarded.ok || !guarded.id) {
    return { ok: false, messageId: null, error: guarded.error || "channel_not_configured" };
  }
  tgLog("notes_order_alert_channel", { channel: maskChannelId(guarded.id), event: NOTES_ORDER_ALERT_EVENT }, "info");
  const res = await sendMessage({
    chat_id: guarded.id,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: false,
  });
  if (!res.ok) return { ok: false, messageId: null, error: res.description || "send_failed" };
  const messageId = (res.result as { message_id?: number } | undefined)?.message_id ?? null;
  return { ok: true, messageId, error: null };
}

async function listFailedOutbox(limit: number): Promise<NotesOutboxRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("telegram_report_snapshots")
    .select("metrics,message_html")
    .eq("kind", KIND)
    .order("created_at", { ascending: true })
    .limit(200);
  const rows = (data || [])
    .map((row) => rowFromMetrics("", (row.metrics as Record<string, unknown> | null) || null, row.message_html ? String(row.message_html) : null))
    .filter((row): row is NotesOutboxRow => !!row && row.status === "failed" && row.attempts < MAX_ATTEMPTS);
  return rows.slice(0, limit);
}
