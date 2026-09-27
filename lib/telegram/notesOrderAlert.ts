/**
 * Real-time Telegram alert for a newly paid Notes Store order.
 *
 * Fires only after the order row is committed. Telegram failures stay in this
 * module. Each destination has its own snapshot row, so a retry of one channel
 * does not resend the other. The legacy `notes_order_paid:<orderId>` row is
 * never rewritten.
 */
import { waitUntil } from "@vercel/functions";
import { getChat, sendMessage } from "./botApi";
import { tgLog } from "./log";
import { getSupabaseAdmin } from "../supabase";
import { storeDb } from "../store/db";
import { assertReportsChannel } from "./reports/channelGuard";
import { getReportSettings, maskChannelId, resolveReportsChannelId } from "./reports/settings";
import {
  NOTES_ALERT_DESTINATIONS,
  NOTES_ORDER_ALERT_EVENT,
  NOTES_ORDER_ALERT_GRACE_MS,
  NOTES_ORDER_REPLAY_ORDER_NO,
  formatNotesOrderAlertHtml,
  isAlertQualifyingOrder,
  isAlertTestOrder,
  notesOrderPaidLegacySlot,
  notesOrderPaidSlot,
  notesOrderReplayRequestSlot,
  notesOrderReplaySlot,
  notesOrdersNeedingBaselineSkip,
  notesPaidAlertCounts,
  resolveNotesAlertCustomer,
  salesAdmissionsTitleMatches,
  type NotesAlertCustomer,
  type NotesAlertDestination,
  type NotesAlertOrder,
} from "./notesOrderAlertFormat";

export { shouldFireNotesPaidAlert } from "./notesOrderAlertFormat";

const DUAL_CUTOFF_SLOT = "notes_order_dual_alerts_cutoff";
const KIND = "notes_order_outbox";
const REPLAY_KIND = "notes_order_replay";
const REQUEST_KIND = "notes_order_replay_request";
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

export interface NotesDualAlertResult {
  executive: NotesAlertResult;
  sales_admissions: NotesAlertResult;
  messageIds?: Partial<Record<NotesAlertDestination, number | null>>;
}

interface NotesOutboxRow {
  slotKey: string;
  orderId: string;
  orderNo: string | null;
  destination: NotesAlertDestination | "legacy" | null;
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
  getOutbox: (slotKey: string) => Promise<NotesOutboxRow | null>;
  saveOutbox: (row: NotesOutboxRow) => Promise<void>;
  loadOrders: () => Promise<NotesAlertOrder[] | null>;
  loadCustomer: (orderId: string) => Promise<NotesAlertCustomer>;
  readCutoff: () => Promise<string | null>;
  insertCutoff: (iso: string) => Promise<boolean>;
  send: (destination: NotesAlertDestination, html: string) => Promise<{ ok: boolean; messageId: number | null; error: string | null }>;
  sleep: (ms: number) => Promise<void>;
  backoffs: number[];
  now: () => number;
  listFailed: () => Promise<NotesOutboxRow[]>;
  readReplayRequest: () => Promise<NotesOutboxRow | null>;
  saveReplayRequest: (status: string, detail: Record<string, string | number | null>) => Promise<void>;
}

function emptyRow(input: NotesPaidAlertInput, slotKey: string, destination: NotesAlertDestination, nowIso: string): NotesOutboxRow {
  return {
    slotKey,
    orderId: input.orderId,
    orderNo: input.orderNo,
    destination,
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

function logAlert(orderId: string, destination: string, result: string, extra: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
  tgLog("notes_order_alert", { orderId, destination, result, event: NOTES_ORDER_ALERT_EVENT, ...extra }, level);
}

async function claim(
  input: NotesPaidAlertInput,
  slotKey: string,
  destination: NotesAlertDestination,
  deps: AlertDeps,
): Promise<{ state: "owner" | "duplicate" | "skipped" | "busy" | "exhausted"; row: NotesOutboxRow }> {
  const existing = await deps.getOutbox(slotKey);
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
        slotKey,
        destination,
        orderNo: existing.orderNo || input.orderNo,
        amountPaise: existing.amountPaise ?? input.amountPaise,
        paidAt: existing.paidAt || input.paidAt,
        status: "pending",
        updatedAt: nowIso,
        lastError: null,
      }
    : emptyRow(input, slotKey, destination, nowIso);
  await deps.saveOutbox(row);
  return { state: "owner", row };
}

async function ensureDualBaseline(deps: AlertDeps): Promise<number> {
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
  const nowIso = new Date(deps.now()).toISOString();
  for (const orderId of ids) {
    const order = orders.find((row) => row.id === orderId);
    const legacy = await deps.getOutbox(notesOrderPaidLegacySlot(orderId));
    for (const destination of NOTES_ALERT_DESTINATIONS) {
      const slotKey = notesOrderPaidSlot(orderId, destination);
      const existing = await deps.getOutbox(slotKey);
      if (existing) continue;
      if (destination === "executive" && legacy && (legacy.status === "sent" || legacy.status === "skipped")) continue;
      await deps.saveOutbox({
        slotKey,
        orderId,
        orderNo: order?.orderNo || null,
        destination,
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
      logAlert(orderId, destination, "pre_existing");
    }
  }
  return marked;
}

async function deliverOne(
  input: NotesPaidAlertInput,
  destination: NotesAlertDestination,
  deps: AlertDeps,
  opts: { variant: "new" | "updated"; slotKey: string; customer: NotesAlertCustomer; ignoreLegacy?: boolean },
): Promise<NotesAlertResult> {
  if (destination === "executive" && !opts.ignoreLegacy) {
    const legacy = await deps.getOutbox(notesOrderPaidLegacySlot(input.orderId));
    if (legacy?.status === "sent") {
      logAlert(input.orderId, destination, "already_sent");
      return "duplicate";
    }
    if (legacy?.status === "skipped") {
      logAlert(input.orderId, destination, "already_sent");
      return "skipped";
    }
  }
  if (destination === "sales_admissions" && !opts.ignoreLegacy) {
    const legacy = await deps.getOutbox(notesOrderPaidLegacySlot(input.orderId));
    if (legacy && (legacy.status === "sent" || legacy.status === "skipped" || legacy.status === "failed")) {
      const slotKey = opts.slotKey;
      const existing = await deps.getOutbox(slotKey);
      if (!existing || (existing.status !== "sent" && existing.status !== "skipped")) {
        const nowIso = new Date(deps.now()).toISOString();
        await deps.saveOutbox({
          ...(existing || emptyRow(input, slotKey, destination, nowIso)),
          slotKey,
          destination,
          status: "skipped",
          lastError: "pre_existing",
          updatedAt: nowIso,
        });
      }
      logAlert(input.orderId, destination, "pre_existing");
      return "skipped";
    }
  }

  const claimed = await claim(input, opts.slotKey, destination, deps);
  if (claimed.state !== "owner") {
    const result = claimed.state === "exhausted" ? "failed" : claimed.state;
    logAlert(input.orderId, destination, claimed.state === "duplicate" || claimed.state === "busy" ? "already_sent" : result);
    return result;
  }

  try {
    const orders = await deps.loadOrders();
    const self = orders?.find((order) => order.id === input.orderId) || null;
    if (opts.variant === "new" && self && isAlertTestOrder(self)) {
      await deps.saveOutbox({ ...claimed.row, status: "skipped", lastError: "test_order", updatedAt: new Date(deps.now()).toISOString() });
      logAlert(input.orderId, destination, "test_order");
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
      logAlert(input.orderId, destination, "retry", { error: "orders_unreadable" }, "error");
      return "failed";
    }

    const cutoffIso = await deps.readCutoff();
    const cutoffMs = cutoffIso ? Date.parse(cutoffIso) : Number.NaN;
    const paidMs = Date.parse(input.paidAt);
    if (opts.variant === "new" && Number.isFinite(cutoffMs) && Number.isFinite(paidMs) && paidMs < cutoffMs - NOTES_ORDER_ALERT_GRACE_MS) {
      await deps.saveOutbox({
        ...claimed.row,
        status: "skipped",
        lastError: "pre_existing",
        updatedAt: new Date(deps.now()).toISOString(),
      });
      logAlert(input.orderId, destination, "pre_existing");
      return "skipped";
    }

    const paidAt = input.paidAt || self?.paidAt || new Date(deps.now()).toISOString();
    const counts = notesPaidAlertCounts(orders, input.orderId, paidAt);
    const again = await deps.getOutbox(opts.slotKey);
    const html =
      again?.html ||
      claimed.row.html ||
      formatNotesOrderAlertHtml({
        orderNo: input.orderNo || self?.orderNo || "",
        sequence: counts.sequence,
        items: self?.items || [],
        paidPaise: input.amountPaise,
        paidAt,
        todayCount: counts.today,
        totalCount: counts.total,
        customer: opts.customer,
        variant: opts.variant,
      });
    let attempts = claimed.row.attempts;
    let lastError: string | null = null;
    const pending: NotesOutboxRow = {
      ...claimed.row,
      slotKey: opts.slotKey,
      destination,
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
      logAlert(input.orderId, destination, "attempt", { attempt: attempts });
      const res = await deps.send(destination, html).catch((error) => ({
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
        logAlert(input.orderId, destination, "sent", { messageId: res.messageId, attempt: attempts });
        return "sent";
      }
      lastError = res.error || "send_failed";
      logAlert(input.orderId, destination, "retry", { attempt: attempts, error: lastError }, "error");
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
    logAlert(input.orderId, destination, "retry", { error: (error as Error).message }, "error");
    return "failed";
  }
}

export async function deliverNotesOrderPaidAlert(input: NotesPaidAlertInput, override?: Partial<AlertDeps>): Promise<NotesDualAlertResult> {
  const deps = override ? { ...defaultDeps(), ...override } : defaultDeps();
  const out: NotesDualAlertResult = { executive: "failed", sales_admissions: "failed", messageIds: {} };
  try {
    logAlert(input.orderId, "both", "detected");
    try {
      await ensureDualBaseline(deps);
    } catch (error) {
      tgLog("notes_order_alert_baseline_failed", { orderId: input.orderId, error: (error as Error).message }, "error");
    }
    const customer = await deps.loadCustomer(input.orderId).catch(() => ({
      name: "Not available",
      phone: "Not available",
      city: "Not available",
    }));
    for (const destination of NOTES_ALERT_DESTINATIONS) {
      out[destination] = await deliverOne(input, destination, deps, {
        variant: "new",
        slotKey: notesOrderPaidSlot(input.orderId, destination),
        customer,
      });
      const row = await deps.getOutbox(notesOrderPaidSlot(input.orderId, destination));
      if (out.messageIds) out.messageIds[destination] = row?.messageId ?? null;
    }
    return out;
  } catch (error) {
    logAlert(input.orderId, "both", "retry", { error: (error as Error).message }, "error");
    return out;
  }
}

/** Read-only replay of the one requested existing order. Does not touch payment, order, or legacy alert rows. */
export async function replayNotesOrderUpdatedAlert(orderNo: string, override?: Partial<AlertDeps>): Promise<NotesDualAlertResult> {
  const deps = override ? { ...defaultDeps(), ...override } : defaultDeps();
  const wanted = orderNo.trim().toUpperCase();
  if (wanted !== NOTES_ORDER_REPLAY_ORDER_NO) {
    logAlert(wanted, "both", "replay_refused");
    return { executive: "skipped", sales_admissions: "skipped", messageIds: {} };
  }
  const orders = await deps.loadOrders();
  const order = orders?.find((row) => row.orderNo.toUpperCase() === wanted) || null;
  if (!order || !isAlertQualifyingOrder(order)) {
    return { executive: "skipped", sales_admissions: "skipped", messageIds: {} };
  }
  const customer = await deps.loadCustomer(order.id);
  const input: NotesPaidAlertInput = {
    orderId: order.id,
    orderNo: order.orderNo,
    amountPaise: order.amountPaidPaise ?? 0,
    paidAt: order.paidAt || new Date(deps.now()).toISOString(),
  };
  const out: NotesDualAlertResult = { executive: "failed", sales_admissions: "failed", messageIds: {} };
  for (const destination of NOTES_ALERT_DESTINATIONS) {
    out[destination] = await deliverOne(input, destination, deps, {
      variant: "updated",
      slotKey: notesOrderReplaySlot(order.id, destination),
      customer,
      ignoreLegacy: true,
    });
    const row = await deps.getOutbox(notesOrderReplaySlot(order.id, destination));
    if (out.messageIds) out.messageIds[destination] = row?.messageId ?? null;
  }
  return out;
}

export function fireNotesOrderPaidAlert(input: NotesPaidAlertInput): void {
  const run = async () => {
    try {
      await deliverNotesOrderPaidAlert(input);
    } catch (error) {
      logAlert(input.orderId, "both", "retry", { error: (error as Error).message }, "error");
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
    baselined = await ensureDualBaseline(deps);
  } catch (error) {
    tgLog("notes_order_alert_baseline_failed", { error: (error as Error).message }, "error");
  }
  let sent = 0;
  let failed = 0;
  let due = 0;

  const request = await deps.readReplayRequest().catch(() => null);
  if (request && request.status === "pending") {
    due += 1;
    const replay = await replayNotesOrderUpdatedAlert(NOTES_ORDER_REPLAY_ORDER_NO, deps);
    const done = (["executive", "sales_admissions"] as const).every((destination) => replay[destination] === "sent" || replay[destination] === "duplicate");
    await deps.saveReplayRequest(done ? "sent" : "pending", {
      executive: replay.executive,
      sales_admissions: replay.sales_admissions,
      executive_message_id: replay.messageIds?.executive ?? null,
      sales_message_id: replay.messageIds?.sales_admissions ?? null,
    });
    if (replay.executive === "sent") sent += 1;
    if (replay.sales_admissions === "sent") sent += 1;
    if (replay.executive === "failed") failed += 1;
    if (replay.sales_admissions === "failed") failed += 1;
  }

  const failedRows = (await deps.listFailed()).slice(0, limit);
  due += failedRows.length;
  for (const row of failedRows) {
    if (!row.destination || row.destination === "legacy") continue;
    if (row.slotKey.startsWith("notes_order_manual_replay:")) {
      const replay = await replayNotesOrderUpdatedAlert(row.orderNo || "", deps);
      if (replay[row.destination] === "sent") sent += 1;
      else if (replay[row.destination] === "failed") failed += 1;
      continue;
    }
    const customer = await deps.loadCustomer(row.orderId);
    const result = await deliverOne(
      {
        orderId: row.orderId,
        orderNo: row.orderNo,
        amountPaise: row.amountPaise ?? 0,
        paidAt: row.paidAt || new Date(deps.now()).toISOString(),
      },
      row.destination,
      deps,
      { variant: "new", slotKey: row.slotKey, customer },
    );
    if (result === "sent") sent += 1;
    else if (result === "failed") failed += 1;
  }
  return { due, sent, failed, baselined };
}

function defaultDeps(): AlertDeps {
  return {
    getOutbox: productionGetOutbox,
    saveOutbox: productionSaveOutbox,
    loadOrders: productionLoadOrders,
    loadCustomer: productionLoadCustomer,
    readCutoff: productionReadCutoff,
    insertCutoff: productionInsertCutoff,
    send: productionSend,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    backoffs: DEFAULT_BACKOFFS,
    now: () => Date.now(),
    listFailed: listFailedOutbox,
    readReplayRequest: productionReadReplayRequest,
    saveReplayRequest: productionSaveReplayRequest,
  };
}

function metricsOf(row: NotesOutboxRow): Record<string, string | number | null> {
  return {
    event: row.slotKey.includes("manual_replay") ? "notes_order_manual_replay" : NOTES_ORDER_ALERT_EVENT,
    order_id: row.orderId,
    order_no: row.orderNo,
    destination: row.destination,
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

function rowFromMetrics(slotKey: string, metrics: Record<string, unknown> | null, html: string | null): NotesOutboxRow | null {
  if (!metrics) return null;
  const status = metrics.status;
  if (status !== "pending" && status !== "sent" && status !== "failed" && status !== "skipped") return null;
  const destination = metrics.destination;
  return {
    slotKey,
    orderId: typeof metrics.order_id === "string" ? metrics.order_id : "",
    orderNo: typeof metrics.order_no === "string" ? metrics.order_no : null,
    destination: destination === "executive" || destination === "sales_admissions" || destination === "legacy" ? destination : null,
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

async function productionGetOutbox(slotKey: string): Promise<NotesOutboxRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("telegram_report_snapshots").select("metrics,message_html").eq("slot_key", slotKey).maybeSingle();
  if (!data) return null;
  return rowFromMetrics(slotKey, (data.metrics as Record<string, unknown> | null) || null, data.message_html ? String(data.message_html) : null);
}

async function productionSaveOutbox(row: NotesOutboxRow): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const { error } = await db.from("telegram_report_snapshots").upsert(
    {
      slot_key: row.slotKey,
      kind: row.slotKey.includes("manual_replay") ? REPLAY_KIND : KIND,
      metrics: metricsOf(row),
      message_html: row.html,
    },
    { onConflict: "slot_key" },
  );
  if (error) tgLog("notes_order_alert_outbox_failed", { orderId: row.orderId, destination: row.destination, error: error.message }, "error");
}

async function productionLoadOrders(): Promise<NotesAlertOrder[] | null> {
  const db = storeDb();
  if (!db) return null;
  const { data, error } = await db.from("store_orders").select("id,order_no,status,paid_at,amount_paid_paise").not("paid_at", "is", null).limit(2000);
  if (error || !data) return null;
  const rows = data as { id: string; order_no: string; status: string; paid_at: string | null; amount_paid_paise: number | null }[];
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

async function productionLoadCustomer(orderId: string): Promise<NotesAlertCustomer> {
  const db = storeDb();
  if (!db) return { name: "Not available", phone: "Not available", city: "Not available" };
  const { data: order } = await db.from("store_orders").select("customer_name,phone,shipping_address_id").eq("id", orderId).maybeSingle();
  let shipping: { name?: string | null; phone?: string | null; city?: string | null; country?: string | null } | null = null;
  const addressId = (order as { shipping_address_id?: string | null } | null)?.shipping_address_id;
  if (addressId) {
    const { data } = await db.from("store_addresses").select("name,phone,city,country").eq("id", addressId).maybeSingle();
    shipping = data;
  }
  const row = order as { customer_name?: string | null; phone?: string | null } | null;
  return resolveNotesAlertCustomer({
    shippingName: shipping?.name,
    customerName: row?.customer_name,
    shippingPhone: shipping?.phone,
    orderPhone: row?.phone,
    country: shipping?.country,
    city: shipping?.city,
  });
}

async function productionReadCutoff(): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("telegram_report_snapshots").select("metrics").eq("slot_key", DUAL_CUTOFF_SLOT).maybeSingle();
  const iso = (data?.metrics as { cutoffIso?: string } | null)?.cutoffIso;
  return iso && Number.isFinite(Date.parse(iso)) ? iso : null;
}

async function productionInsertCutoff(iso: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { error } = await db.from("telegram_report_snapshots").insert({
    slot_key: DUAL_CUTOFF_SLOT,
    kind: "notes_order_alert_cutoff",
    metrics: { cutoffIso: iso, graceMs: NOTES_ORDER_ALERT_GRACE_MS, event: NOTES_ORDER_ALERT_EVENT, destinations: "executive,sales_admissions" },
  });
  return !error;
}

async function productionSend(destination: NotesAlertDestination, html: string): Promise<{ ok: boolean; messageId: number | null; error: string | null }> {
  if (destination === "sales_admissions") {
    const id = (process.env.TELEGRAM_SALES_CHAT_ID || "").trim();
    if (!id) return { ok: false, messageId: null, error: "sales_chat_unset" };
    const chat = await getChat(id);
    const title = chat.ok ? chat.result?.title || null : null;
    const type = chat.ok ? chat.result?.type || null : null;
    if (!chat.ok || (type !== "channel" && type !== "supergroup") || !salesAdmissionsTitleMatches(title)) {
      tgLog("notes_order_alert_channel", { destination, result: "unverified", type, title: title || null }, "error");
      return { ok: false, messageId: null, error: "sales_channel_unverified" };
    }
    tgLog("notes_order_alert_channel", { destination, result: "verified", channel: maskChannelId(String(chat.result?.id || id)) }, "info");
    const res = await sendMessage({
      chat_id: chat.result?.id || id,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: false,
    });
    if (!res.ok) return { ok: false, messageId: null, error: res.description || "send_failed" };
    return { ok: true, messageId: (res.result as { message_id?: number } | undefined)?.message_id ?? null, error: null };
  }
  const settings = await getReportSettings();
  const resolved = resolveReportsChannelId(settings);
  const guarded = await assertReportsChannel(resolved);
  if (!guarded.ok || !guarded.id) return { ok: false, messageId: null, error: guarded.error || "channel_not_configured" };
  tgLog("notes_order_alert_channel", { destination, result: "verified", channel: maskChannelId(guarded.id) }, "info");
  const res = await sendMessage({
    chat_id: guarded.id,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: false,
  });
  if (!res.ok) return { ok: false, messageId: null, error: res.description || "send_failed" };
  return { ok: true, messageId: (res.result as { message_id?: number } | undefined)?.message_id ?? null, error: null };
}

async function listFailedOutbox(): Promise<NotesOutboxRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("telegram_report_snapshots").select("slot_key,metrics,message_html").in("kind", [KIND, REPLAY_KIND]).order("created_at", { ascending: true }).limit(200);
  return (data || [])
    .map((row) => rowFromMetrics(String(row.slot_key), (row.metrics as Record<string, unknown> | null) || null, row.message_html ? String(row.message_html) : null))
    .filter((row): row is NotesOutboxRow => {
      if (!row || !row.destination || row.destination === "legacy" || row.attempts >= MAX_ATTEMPTS) return false;
      if (row.status === "failed") return true;
      if (row.status !== "pending") return false;
      const age = Date.now() - Date.parse(row.updatedAt);
      return Number.isFinite(age) && age >= LEASE_MS;
    });
}

async function productionReadReplayRequest(): Promise<NotesOutboxRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const slotKey = notesOrderReplayRequestSlot(NOTES_ORDER_REPLAY_ORDER_NO);
  const { data } = await db.from("telegram_report_snapshots").select("metrics").eq("slot_key", slotKey).maybeSingle();
  if (!data) return null;
  return rowFromMetrics(slotKey, (data.metrics as Record<string, unknown> | null) || null, null);
}

async function productionSaveReplayRequest(status: string, detail: Record<string, string | number | null>): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const slotKey = notesOrderReplayRequestSlot(NOTES_ORDER_REPLAY_ORDER_NO);
  await db.from("telegram_report_snapshots").upsert(
    {
      slot_key: slotKey,
      kind: REQUEST_KIND,
      metrics: {
        event: "notes_order_manual_replay",
        order_no: NOTES_ORDER_REPLAY_ORDER_NO,
        status,
        ...detail,
        updated_at: new Date().toISOString(),
      },
      message_html: null,
    },
    { onConflict: "slot_key" },
  );
}
