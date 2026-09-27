/**
 * Sales & Admissions alerts for Notes checkout leads.
 *
 * Fires only after the abandonment sweep has committed a stage change, or after
 * a paid conversion of a lead that was already alerted. Telegram never throws
 * into checkout, payment, or the sweep.
 */
import { waitUntil } from "@vercel/functions";
import { editMessageText, getChat, sendMessage } from "./botApi";
import { tgLog } from "./log";
import { getSupabaseAdmin } from "../supabase";
import { storeDb } from "../store/db";
import { sweepCheckoutLeads } from "../store/checkoutLeads";
import type { CheckoutStage, SalesStatus } from "../store/checkoutLeadLogic";
import { maskChannelId } from "./reports/settings";
import { formatNotesAlertStamp } from "./notesOrderAlertFormat";
import {
  NOTES_LEAD_QA_PHONE,
  NOTES_LEAD_QA_REQUEST_SLOT,
  abandonedAlertDecision,
  formatNotesLeadAlertHtml,
  formatNotesLeadConvertedFollowUp,
  notesLeadAlertAnalytics,
  notesLeadAlertSlot,
  notesLeadKindForStage,
  salesAdmissionsTitleMatches,
  type NotesLeadAlertKind,
  type NotesLeadAlertRecord,
  type NotesLeadCartLine,
  type NotesLeadTouch,
} from "./notesLeadAlertFormat";

const CUTOFF_SLOT = "notes_lead_sales_alerts_cutoff";
const KIND = "notes_lead_outbox";
const REQUEST_KIND = "notes_lead_qa_request";
const LEASE_MS = 90_000;
const MAX_ATTEMPTS = 8;
const UNPAID = new Set(["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED"]);

type AlertStatus = "pending" | "sent" | "failed" | "skipped";
type DeliverResult = "sent" | "duplicate" | "skipped" | "failed" | "busy";

interface OutboxRow {
  slotKey: string;
  leadId: string;
  kind: NotesLeadAlertKind;
  status: AlertStatus;
  attempts: number;
  lastError: string | null;
  messageId: number | null;
  html: string | null;
  updatedAt: string;
  sentAt: string | null;
  edited: boolean;
}

interface AlertDeps {
  getOutbox: (slotKey: string) => Promise<OutboxRow | null>;
  saveOutbox: (row: OutboxRow) => Promise<void>;
  reload: (leadId: string) => Promise<NotesLeadAlertRecord | null>;
  send: (html: string, replyTo: number | null) => Promise<{ ok: boolean; messageId: number | null; error: string | null }>;
  edit: (messageId: number, html: string) => Promise<{ ok: boolean; error: string | null }>;
  readCutoff: () => Promise<string | null>;
  insertCutoff: (iso: string) => Promise<boolean>;
  loadAbandoned: () => Promise<NotesLeadAlertRecord[]>;
  loadRecentConverted: (cutoffIso: string) => Promise<string[]>;
  listRetryable: () => Promise<OutboxRow[]>;
  readQaRequest: () => Promise<{ status: string; leadId: string | null } | null>;
  saveQaRequest: (status: string, detail: Record<string, string | number | null>) => Promise<void>;
  ensureQaLead: () => Promise<NotesLeadAlertRecord | null>;
  markQaConverted: (leadId: string) => Promise<void>;
  track: (lead: NotesLeadAlertRecord, kind: NotesLeadAlertKind) => Promise<void>;
  now: () => number;
  backoffs: number[];
  sleep: (ms: number) => Promise<void>;
}

function logLead(leadId: string, kind: string, result: string, extra: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
  tgLog("notes_lead_alert", { leadId, kind, destination: "sales_admissions", result, ...extra }, level);
}

function emptyRow(leadId: string, kind: NotesLeadAlertKind, nowIso: string): OutboxRow {
  return {
    slotKey: notesLeadAlertSlot(kind, leadId),
    leadId,
    kind,
    status: "pending",
    attempts: 0,
    lastError: null,
    messageId: null,
    html: null,
    updatedAt: nowIso,
    sentAt: null,
    edited: false,
  };
}

async function claim(leadId: string, kind: NotesLeadAlertKind, deps: AlertDeps): Promise<{ state: "owner" | "duplicate" | "skipped" | "busy" | "exhausted"; row: OutboxRow }> {
  const slotKey = notesLeadAlertSlot(kind, leadId);
  const existing = await deps.getOutbox(slotKey);
  const nowIso = new Date(deps.now()).toISOString();
  if (existing?.status === "sent") return { state: "duplicate", row: existing };
  if (existing?.status === "skipped") return { state: "skipped", row: existing };
  if (existing && existing.attempts >= MAX_ATTEMPTS) return { state: "exhausted", row: existing };
  if (existing?.status === "pending") {
    const age = deps.now() - Date.parse(existing.updatedAt);
    if (Number.isFinite(age) && age >= 0 && age < LEASE_MS) return { state: "busy", row: existing };
  }
  const row = existing ? { ...existing, status: "pending" as const, updatedAt: nowIso, lastError: null } : emptyRow(leadId, kind, nowIso);
  await deps.saveOutbox(row);
  return { state: "owner", row };
}

async function ensureCutoff(deps: AlertDeps): Promise<number> {
  let iso = await deps.readCutoff();
  if (!iso) {
    const proposed = new Date(deps.now()).toISOString();
    const won = await deps.insertCutoff(proposed);
    iso = won ? proposed : (await deps.readCutoff()) || proposed;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : deps.now();
}

async function skip(row: OutboxRow, reason: string, deps: AlertDeps): Promise<void> {
  await deps.saveOutbox({ ...row, status: "skipped", lastError: reason, updatedAt: new Date(deps.now()).toISOString() });
}

export async function deliverAbandonedLead(lead: NotesLeadAlertRecord, override?: Partial<AlertDeps>, opts?: { qa?: boolean; requested?: "checkout" | "payment" }): Promise<DeliverResult> {
  const deps = { ...defaultDeps(), ...override };
  const kind = opts?.requested || notesLeadKindForStage(lead.stage);
  if (!kind) return "skipped";
  try {
    const fresh = (await deps.reload(lead.id)) || lead;
    const prior = kind === "payment" ? await deps.getOutbox(notesLeadAlertSlot("checkout", fresh.id)) : null;
    const record: NotesLeadAlertRecord = { ...fresh, priorCheckoutMessageId: prior?.status === "sent" ? prior.messageId : null };
    const cutoffMs = opts?.qa ? null : await ensureCutoff(deps);
    const decision = abandonedAlertDecision({
      requested: kind,
      stage: record.stage,
      salesStatus: record.salesStatus,
      lastActivityAt: record.lastActivityAt,
      cutoffMs,
      paid: record.paid,
      qa: opts?.qa,
    });
    if (decision === "historical" || decision === "active") {
      logLead(record.id, kind, decision);
      return "skipped";
    }
    const claimed = await claim(record.id, kind, deps);
    if (claimed.state !== "owner") {
      logLead(record.id, kind, claimed.state === "duplicate" || claimed.state === "busy" ? "already_sent" : claimed.state);
      return claimed.state === "exhausted" ? "failed" : claimed.state;
    }
    if (decision !== "send") {
      await skip(claimed.row, decision, deps);
      logLead(record.id, kind, decision);
      return "skipped";
    }
    const again = (await deps.reload(record.id)) || record;
    const againDecision = abandonedAlertDecision({
      requested: kind,
      stage: again.stage,
      salesStatus: again.salesStatus,
      lastActivityAt: again.lastActivityAt,
      cutoffMs,
      paid: again.paid,
      qa: opts?.qa,
    });
    if (againDecision !== "send") {
      await skip(claimed.row, againDecision, deps);
      logLead(again.id, kind, againDecision);
      return "skipped";
    }
    const escalation = kind === "payment" && Boolean(record.priorCheckoutMessageId);
    const html = claimed.row.html || formatNotesLeadAlertHtml({ lead: { ...again, priorCheckoutMessageId: record.priorCheckoutMessageId }, kind, escalation });
    let attempts = claimed.row.attempts;
    let lastError: string | null = null;
    const pending = { ...claimed.row, html, status: "pending" as const, updatedAt: new Date(deps.now()).toISOString() };
    await deps.saveOutbox(pending);
    for (const wait of deps.backoffs) {
      if (wait > 0) await deps.sleep(wait);
      attempts += 1;
      logLead(again.id, kind, "attempt", { attempt: attempts });
      const res = await deps.send(html, escalation ? record.priorCheckoutMessageId : null).catch((error) => ({
        ok: false as const,
        messageId: null,
        error: (error as Error).message || "send_threw",
      }));
      if (res.ok && res.messageId) {
        const sentAt = new Date(deps.now()).toISOString();
        await deps.saveOutbox({ ...pending, status: "sent", attempts, lastError: null, messageId: res.messageId, updatedAt: sentAt, sentAt });
        logLead(again.id, kind, "sent", { messageId: res.messageId, attempt: attempts });
        void deps.track(again, kind).catch(() => {});
        return "sent";
      }
      if (res.ok && !res.messageId) {
        lastError = "message_id_missing";
        logLead(again.id, kind, "retry", { attempt: attempts, error: lastError }, "error");
        continue;
      }
      lastError = res.error || "send_failed";
      logLead(again.id, kind, "retry", { attempt: attempts, error: lastError }, "error");
    }
    await deps.saveOutbox({ ...pending, status: "failed", attempts, lastError, updatedAt: new Date(deps.now()).toISOString() });
    return "failed";
  } catch (error) {
    logLead(lead.id, kind, "retry", { error: (error as Error).message }, "error");
    return "failed";
  }
}

export async function deliverLeadConvertedAlert(leadId: string, override?: Partial<AlertDeps>, opts?: { orderNo?: string | null; paidPaise?: number | null }): Promise<DeliverResult> {
  const deps = { ...defaultDeps(), ...override };
  try {
    const lead = await deps.reload(leadId);
    if (!lead || lead.stage !== "CONVERTED") return "skipped";
    const checkout = await deps.getOutbox(notesLeadAlertSlot("checkout", leadId));
    const payment = await deps.getOutbox(notesLeadAlertSlot("payment", leadId));
    const targets = [payment, checkout].filter((row): row is OutboxRow => Boolean(row && row.status === "sent" && row.messageId));
    const claimed = await claim(leadId, "converted", deps);
    if (claimed.state !== "owner") return claimed.state === "exhausted" ? "failed" : claimed.state;
    if (!targets.length) {
      await skip(claimed.row, "no_prior_alert", deps);
      logLead(leadId, "converted", "no_prior_alert");
      return "skipped";
    }
    const paidPaise = opts?.paidPaise ?? lead.paidPaise ?? lead.cartValuePaise;
    const orderNo = opts?.orderNo ?? lead.orderNo;
    const current = { ...lead, paid: true, paidPaise, orderNo };
    let messageId: number | null = null;
    let edited = false;
    let delivered = false;
    let lastError: string | null = null;
    for (const target of targets) {
      if (!target.messageId || target.kind === "converted") continue;
      const html = formatNotesLeadAlertHtml({
        lead: current,
        kind: target.kind,
        escalation: target.kind === "payment" && Boolean(checkout?.messageId),
        converted: { paidPaise, orderNo },
      });
      const res = await deps.edit(target.messageId, html).catch((error) => ({ ok: false, error: (error as Error).message || "edit_threw" }));
      if (res.ok) {
        edited = true;
        delivered = true;
        messageId = target.messageId;
        continue;
      }
      const follow = formatNotesLeadConvertedFollowUp({ lead: current, paidPaise, orderNo });
      const sent = await deps.send(follow, target.messageId).catch((error) => ({
        ok: false as const,
        messageId: null,
        error: (error as Error).message || "send_threw",
      }));
      if (sent.ok && sent.messageId) {
        delivered = true;
        messageId = sent.messageId;
        continue;
      }
      lastError = ("error" in sent ? sent.error : null) || res.error || "conversion_failed";
    }
    if (!delivered || !messageId) {
      await deps.saveOutbox({ ...claimed.row, status: "failed", attempts: claimed.row.attempts + 1, lastError, updatedAt: new Date(deps.now()).toISOString() });
      logLead(leadId, "converted", "retry", { error: lastError }, "error");
      return "failed";
    }
    const sentAt = new Date(deps.now()).toISOString();
    await deps.saveOutbox({
      ...claimed.row,
      status: "sent",
      attempts: claimed.row.attempts + 1,
      lastError: null,
      messageId,
      html: null,
      updatedAt: sentAt,
      sentAt,
      edited,
    });
    logLead(leadId, "converted", edited ? "edited" : "sent", { messageId });
    void deps.track(current, "converted").catch(() => {});
    return "sent";
  } catch (error) {
    logLead(leadId, "converted", "retry", { error: (error as Error).message }, "error");
    return "failed";
  }
}

export function enqueueLeadConvertedAlert(leadId: string): void {
  const run = async () => {
    try {
      await deliverLeadConvertedAlert(leadId);
    } catch (error) {
      logLead(leadId, "converted", "retry", { error: (error as Error).message }, "error");
    }
  };
  try {
    waitUntil(run());
  } catch {
    void run();
  }
}

export async function loadLeadAlertActivity(leadIds: string[]): Promise<Record<string, { lines: string[] }>> {
  const out: Record<string, { lines: string[] }> = {};
  if (!leadIds.length) return out;
  const db = getSupabaseAdmin();
  if (!db) return out;
  const keys = leadIds.flatMap((id) => [
    notesLeadAlertSlot("checkout", id),
    notesLeadAlertSlot("payment", id),
    notesLeadAlertSlot("converted", id),
  ]);
  const { data } = await db.from("telegram_report_snapshots").select("slot_key,metrics").in("slot_key", keys);
  for (const row of data || []) {
    const metrics = (row.metrics || {}) as Record<string, unknown>;
    const leadId = typeof metrics.lead_id === "string" ? metrics.lead_id : "";
    if (!leadId) continue;
    const kind = metrics.kind === "checkout" || metrics.kind === "payment" || metrics.kind === "converted" ? metrics.kind : "";
    const status = typeof metrics.status === "string" ? metrics.status : "";
    const when = typeof metrics.sent_at === "string" ? formatNotesAlertStamp(metrics.sent_at) : "";
    const line = activityLine(kind, status, typeof metrics.last_error === "string" ? metrics.last_error : "", when);
    if (!line) continue;
    const bucket = out[leadId] || { lines: [] };
    bucket.lines.push(line);
    out[leadId] = bucket;
  }
  return out;
}

function activityLine(kind: string, status: string, error: string, when: string): string | null {
  const stamp = when && when !== "—" ? ` · ${when}` : "";
  if (status === "failed") return "Telegram failed · retrying";
  if (status === "skipped" && error === "do_not_contact") return "Telegram suppressed · do not contact";
  if (status === "skipped" && error === "paid") return "Telegram abandoned alert suppressed · paid";
  if (status !== "sent") return null;
  if (kind === "checkout") return `Telegram sales alert sent${stamp}`;
  if (kind === "payment") return `Telegram hot-lead alert sent${stamp}`;
  if (kind === "converted") return `Telegram conversion update sent${stamp}`;
  return null;
}

export async function sweepNotesLeadAlerts(): Promise<{ due: number; sent: number; failed: number; skipped: number }> {
  const deps = defaultDeps();
  let due = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const tally = (result: DeliverResult) => {
    if (result === "sent") sent += 1;
    else if (result === "failed") failed += 1;
    else skipped += 1;
  };
  try {
    await sweepCheckoutLeads();
  } catch (error) {
    tgLog("notes_lead_alert_sweep_failed", { error: (error as Error).message }, "error");
  }
  const cutoffMs = await ensureCutoff(deps).catch(() => Date.now());
  const leads = await deps.loadAbandoned().catch(() => []);
  for (const lead of leads) {
    const kind = notesLeadKindForStage(lead.stage);
    if (!kind) continue;
    const decision = abandonedAlertDecision({
      requested: kind,
      stage: lead.stage,
      salesStatus: lead.salesStatus,
      lastActivityAt: lead.lastActivityAt,
      cutoffMs,
      paid: lead.paid,
    });
    if (decision === "historical" || decision === "active") continue;
    due += 1;
    tally(await deliverAbandonedLead(lead, deps));
  }
  for (const row of await deps.listRetryable().catch(() => [])) {
    if (row.kind === "converted") {
      due += 1;
      tally(await deliverLeadConvertedAlert(row.leadId, deps));
      continue;
    }
    const lead = await deps.reload(row.leadId);
    if (!lead || (row.kind !== "checkout" && row.kind !== "payment")) continue;
    due += 1;
    tally(await deliverAbandonedLead(lead, deps, { requested: row.kind }));
  }
  const cutoffIso = new Date(cutoffMs).toISOString();
  for (const leadId of await deps.loadRecentConverted(cutoffIso).catch(() => [])) {
    due += 1;
    tally(await deliverLeadConvertedAlert(leadId, deps));
  }
  await runQa(deps, tally).catch((error) => {
    tgLog("notes_lead_alert_qa_failed", { error: (error as Error).message }, "error");
  });
  return { due, sent, failed, skipped };
}

async function runQa(deps: AlertDeps, tally: (result: DeliverResult) => void): Promise<void> {
  const request = await deps.readQaRequest();
  if (!request || request.status !== "pending") return;
  const lead = await deps.ensureQaLead();
  if (!lead) {
    await deps.saveQaRequest("failed", { error: "qa_lead_unavailable" });
    return;
  }
  const prior = await deps.getOutbox(notesLeadAlertSlot("checkout", lead.id));
  const alert = prior?.status === "sent" ? "duplicate" : await deliverAbandonedLead(lead, deps, { qa: true });
  tally(alert);
  if (alert !== "sent" && alert !== "duplicate") {
    await deps.saveQaRequest("pending", { lead_id: lead.id, alert });
    return;
  }
  if (lead.stage !== "CONVERTED") await deps.markQaConverted(lead.id);
  const converted = await deliverLeadConvertedAlert(lead.id, deps, { orderNo: "QA-TEST", paidPaise: lead.cartValuePaise });
  tally(converted);
  const done = converted === "sent" || converted === "duplicate";
  await deps.saveQaRequest(done ? "sent" : "pending", {
    lead_id: lead.id,
    alert,
    converted,
    message_id: (await deps.getOutbox(notesLeadAlertSlot("checkout", lead.id)))?.messageId ?? null,
    conversion_message_id: (await deps.getOutbox(notesLeadAlertSlot("converted", lead.id)))?.messageId ?? null,
  });
}

function defaultDeps(): AlertDeps {
  return {
    getOutbox: productionGetOutbox,
    saveOutbox: productionSaveOutbox,
    reload: productionReload,
    send: productionSend,
    edit: productionEdit,
    readCutoff: productionReadCutoff,
    insertCutoff: productionInsertCutoff,
    loadAbandoned: productionLoadAbandoned,
    loadRecentConverted: productionLoadConverted,
    listRetryable: productionListRetryable,
    readQaRequest: productionReadQa,
    saveQaRequest: productionSaveQa,
    ensureQaLead: productionEnsureQaLead,
    markQaConverted: productionMarkQaConverted,
    track: productionTrack,
    now: () => Date.now(),
    backoffs: [0, 400, 1200],
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function metricsOf(row: OutboxRow): Record<string, string | number | boolean | null> {
  return {
    event: "notes_lead_alert",
    lead_id: row.leadId,
    kind: row.kind,
    destination: "sales_admissions",
    status: row.status,
    attempts: row.attempts,
    last_error: row.lastError,
    message_id: row.messageId,
    updated_at: row.updatedAt,
    sent_at: row.sentAt,
    edited: row.edited,
  };
}

function rowFromMetrics(slotKey: string, metrics: Record<string, unknown> | null, html: string | null): OutboxRow | null {
  if (!metrics) return null;
  const status = metrics.status;
  if (status !== "pending" && status !== "sent" && status !== "failed" && status !== "skipped") return null;
  const kind = metrics.kind === "checkout" || metrics.kind === "payment" || metrics.kind === "converted" ? metrics.kind : null;
  if (!kind) return null;
  return {
    slotKey,
    leadId: typeof metrics.lead_id === "string" ? metrics.lead_id : "",
    kind,
    status,
    attempts: Number(metrics.attempts) || 0,
    lastError: typeof metrics.last_error === "string" ? metrics.last_error : null,
    messageId: typeof metrics.message_id === "number" ? metrics.message_id : null,
    html,
    updatedAt: typeof metrics.updated_at === "string" ? metrics.updated_at : new Date().toISOString(),
    sentAt: typeof metrics.sent_at === "string" ? metrics.sent_at : null,
    edited: metrics.edited === true,
  };
}

async function productionGetOutbox(slotKey: string): Promise<OutboxRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("telegram_report_snapshots").select("metrics,message_html").eq("slot_key", slotKey).maybeSingle();
  if (!data) return null;
  return rowFromMetrics(slotKey, (data.metrics as Record<string, unknown> | null) || null, data.message_html ? String(data.message_html) : null);
}

async function productionSaveOutbox(row: OutboxRow): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const { error } = await db.from("telegram_report_snapshots").upsert(
    { slot_key: row.slotKey, kind: KIND, metrics: metricsOf(row), message_html: row.html },
    { onConflict: "slot_key" },
  );
  if (error) tgLog("notes_lead_alert_outbox_failed", { leadId: row.leadId, kind: row.kind, error: error.message }, "error");
}

function touchOf(value: unknown): NotesLeadTouch | null {
  if (!value || typeof value !== "object") return null;
  const touch = value as Record<string, unknown>;
  const source = typeof touch.source === "string" ? touch.source : null;
  const medium = typeof touch.medium === "string" ? touch.medium : null;
  const campaign = typeof touch.campaign === "string" ? touch.campaign : null;
  const content = typeof touch.content === "string" ? touch.content : null;
  if (!source && !medium && !campaign && !content) return null;
  return { source, medium, campaign, content };
}

function recordFromRow(row: Record<string, unknown>, order?: { paid: boolean; orderNo: string | null; paidPaise: number | null }): NotesLeadAlertRecord {
  const attribution = (row.attribution_json || null) as { last_touch?: unknown; first_touch?: unknown } | null;
  const cart = Array.isArray(row.cart_snapshot) ? (row.cart_snapshot as NotesLeadCartLine[]) : [];
  return {
    id: String(row.id || ""),
    name: typeof row.name === "string" ? row.name : null,
    phone: typeof row.phone === "string" ? row.phone : "",
    stage: row.checkout_stage as CheckoutStage,
    salesStatus: (row.sales_status as SalesStatus) || "NEW",
    cart: cart.map((line) => ({
      product_id: line.product_id || null,
      name: line.name,
      qty: line.qty,
      line_total_paise: line.line_total_paise,
    })),
    cartValuePaise: Number(row.cart_value_paise) || 0,
    couponCode: typeof row.coupon_code === "string" ? row.coupon_code : null,
    couponDiscountPaise: Number(row.coupon_discount_paise) || 0,
    cartAfterDiscountPaise: row.cart_after_discount_paise == null ? null : Number(row.cart_after_discount_paise) || 0,
    lastActivityAt: typeof row.last_activity_at === "string" ? row.last_activity_at : new Date().toISOString(),
    marketingConsent: row.marketing_consent === true,
    touch: touchOf(attribution?.last_touch) || touchOf(attribution?.first_touch),
    orderId: typeof row.order_id === "string" ? row.order_id : null,
    orderNo: order?.orderNo || null,
    paid: Boolean(order?.paid) || row.checkout_stage === "CONVERTED",
    paidPaise: order?.paidPaise ?? (typeof row.converted_value_paise === "number" ? row.converted_value_paise : null),
    isTest: row.is_test === true,
    priorCheckoutMessageId: null,
  };
}

async function orderState(orderId: string | null): Promise<{ paid: boolean; orderNo: string | null; paidPaise: number | null }> {
  if (!orderId) return { paid: false, orderNo: null, paidPaise: null };
  const db = storeDb();
  if (!db) return { paid: false, orderNo: null, paidPaise: null };
  const { data } = await db.from("store_orders").select("order_no,status,paid_at,amount_paid_paise").eq("id", orderId).maybeSingle();
  if (!data) return { paid: false, orderNo: null, paidPaise: null };
  const paid = Boolean(data.paid_at) && !UNPAID.has(String(data.status || ""));
  return {
    paid,
    orderNo: typeof data.order_no === "string" ? data.order_no : null,
    paidPaise: paid ? Number(data.amount_paid_paise) || 0 : null,
  };
}

async function productionReload(leadId: string): Promise<NotesLeadAlertRecord | null> {
  const db = storeDb();
  if (!db) return null;
  const { data } = await db
    .from("store_checkout_leads")
    .select("id,name,phone,checkout_stage,sales_status,cart_snapshot,cart_value_paise,last_activity_at,marketing_consent,attribution_json,order_id,is_test,converted_value_paise,coupon_code,coupon_discount_paise,cart_after_discount_paise")
    .eq("id", leadId)
    .maybeSingle();
  if (!data) return null;
  const order = await orderState(typeof data.order_id === "string" ? data.order_id : null);
  return recordFromRow(data as Record<string, unknown>, order);
}

async function productionLoadAbandoned(): Promise<NotesLeadAlertRecord[]> {
  const db = storeDb();
  if (!db) return [];
  const { data } = await db
    .from("store_checkout_leads")
    .select("id,name,phone,checkout_stage,sales_status,cart_snapshot,cart_value_paise,last_activity_at,marketing_consent,attribution_json,order_id,is_test,converted_value_paise,coupon_code,coupon_discount_paise,cart_after_discount_paise")
    .in("checkout_stage", ["CHECKOUT_ABANDONED", "PAYMENT_ABANDONED"])
    .order("updated_at", { ascending: false })
    .limit(120);
  const rows = (data || []) as Record<string, unknown>[];
  const out: NotesLeadAlertRecord[] = [];
  for (const row of rows) {
    const order = await orderState(typeof row.order_id === "string" ? row.order_id : null);
    out.push(recordFromRow(row, order));
  }
  return out;
}

async function productionLoadConverted(cutoffIso: string): Promise<string[]> {
  const db = storeDb();
  if (!db) return [];
  const { data } = await db
    .from("store_checkout_leads")
    .select("id")
    .eq("checkout_stage", "CONVERTED")
    .gte("converted_at", cutoffIso)
    .order("converted_at", { ascending: false })
    .limit(40);
  return (data || []).map((row) => String(row.id));
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
    kind: "notes_lead_alert_cutoff",
    metrics: { cutoffIso: iso, event: "notes_lead_alert" },
  });
  return !error;
}

async function productionListRetryable(): Promise<OutboxRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("telegram_report_snapshots").select("slot_key,metrics,message_html").eq("kind", KIND).order("created_at", { ascending: true }).limit(200);
  return (data || [])
    .map((row) => rowFromMetrics(String(row.slot_key), (row.metrics as Record<string, unknown> | null) || null, row.message_html ? String(row.message_html) : null))
    .filter((row): row is OutboxRow => {
      if (!row || row.attempts >= MAX_ATTEMPTS) return false;
      if (row.status === "failed") return true;
      if (row.status !== "pending") return false;
      const age = Date.now() - Date.parse(row.updatedAt);
      return Number.isFinite(age) && age >= LEASE_MS;
    });
}

async function verifiedSalesChat(): Promise<{ ok: true; id: string | number } | { ok: false; error: string }> {
  const id = (process.env.TELEGRAM_SALES_CHAT_ID || "").trim();
  if (!id) return { ok: false, error: "sales_chat_unset" };
  const chat = await getChat(id);
  const title = chat.ok ? chat.result?.title || null : null;
  const type = chat.ok ? chat.result?.type || null : null;
  const username = chat.ok ? chat.result?.username || null : null;
  if (!chat.ok || (type !== "channel" && type !== "supergroup") || !salesAdmissionsTitleMatches(title) || username) {
    tgLog("notes_lead_alert_channel", { destination: "sales_admissions", result: "unverified", type, title: title || null, reason: username ? "public_channel" : "title" }, "error");
    return { ok: false, error: username ? "sales_channel_public" : "sales_channel_unverified" };
  }
  tgLog("notes_lead_alert_channel", { destination: "sales_admissions", result: "verified", channel: maskChannelId(String(chat.result?.id || id)) }, "info");
  return { ok: true, id: chat.result?.id || id };
}

async function productionSend(html: string, replyTo: number | null): Promise<{ ok: boolean; messageId: number | null; error: string | null }> {
  const chat = await verifiedSalesChat();
  if (!chat.ok) return { ok: false, messageId: null, error: chat.error };
  const res = await sendMessage({
    chat_id: chat.id,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: false,
    reply_to_message_id: replyTo || undefined,
  });
  if (!res.ok) return { ok: false, messageId: null, error: res.description || "send_failed" };
  return { ok: true, messageId: (res.result as { message_id?: number } | undefined)?.message_id ?? null, error: null };
}

async function productionEdit(messageId: number, html: string): Promise<{ ok: boolean; error: string | null }> {
  const chat = await verifiedSalesChat();
  if (!chat.ok) return { ok: false, error: chat.error };
  const res = await editMessageText({
    chat_id: chat.id,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (!res.ok && /message is not modified/i.test(res.description || "")) return { ok: true, error: null };
  if (!res.ok) return { ok: false, error: res.description || "edit_failed" };
  return { ok: true, error: null };
}

async function productionReadQa(): Promise<{ status: string; leadId: string | null } | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("telegram_report_snapshots").select("metrics").eq("slot_key", NOTES_LEAD_QA_REQUEST_SLOT).maybeSingle();
  if (!data) return null;
  const metrics = (data.metrics || {}) as Record<string, unknown>;
  const status = typeof metrics.status === "string" ? metrics.status : "";
  if (!status) return null;
  return { status, leadId: typeof metrics.lead_id === "string" ? metrics.lead_id : null };
}

async function productionSaveQa(status: string, detail: Record<string, string | number | null>): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("telegram_report_snapshots").upsert(
    {
      slot_key: NOTES_LEAD_QA_REQUEST_SLOT,
      kind: REQUEST_KIND,
      metrics: { event: "notes_lead_qa", status, ...detail, updated_at: new Date().toISOString() },
      message_html: null,
    },
    { onConflict: "slot_key" },
  );
}

async function productionEnsureQaLead(): Promise<NotesLeadAlertRecord | null> {
  const db = storeDb();
  if (!db) return null;
  const { data: rows } = await db
    .from("store_checkout_leads")
    .select("id,is_test,checkout_stage")
    .eq("phone", NOTES_LEAD_QA_PHONE)
    .order("created_at", { ascending: false })
    .limit(5);
  const list = rows || [];
  if (list.some((row) => row.is_test !== true && row.checkout_stage !== "CONVERTED" && row.checkout_stage !== "EXPIRED")) return null;
  const existing = list.find((row) => row.is_test === true) || null;
  if (existing && (existing.checkout_stage === "CONVERTED" || existing.checkout_stage === "EXPIRED")) {
    return productionReload(existing.id);
  }
  const now = new Date();
  const activity = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const cart = [{ product_id: "qa-notes", sku: "QA-NOTES", name: "QA Polity Notes", qty: 1, line_total_paise: 250000 }];
  const patch = {
    phone: NOTES_LEAD_QA_PHONE,
    name: "QA Notes Lead",
    cart_snapshot: cart,
    cart_value_paise: 250000,
    checkout_stage: "CHECKOUT_ABANDONED",
    sales_status: "NEW",
    was_abandoned: true,
    marketing_consent: false,
    is_test: true,
    attribution_json: null,
    order_id: null,
    last_activity_at: activity,
    updated_at: now.toISOString(),
  };
  if (existing?.id) {
    await db.from("store_checkout_leads").update(patch).eq("id", existing.id).eq("is_test", true);
    return productionReload(existing.id);
  }
  const { data: inserted } = await db.from("store_checkout_leads").insert({ ...patch, created_at: now.toISOString() }).select("id").single();
  if (!inserted?.id) return null;
  return productionReload(inserted.id);
}

async function productionMarkQaConverted(leadId: string): Promise<void> {
  const db = storeDb();
  if (!db) return;
  const now = new Date().toISOString();
  await db.from("store_checkout_leads").update({
    checkout_stage: "CONVERTED",
    sales_status: "CONVERTED",
    converted_at: now,
    converted_value_paise: 250000,
    updated_at: now,
    last_activity_at: now,
  }).eq("id", leadId).eq("is_test", true);
}

async function productionTrack(lead: NotesLeadAlertRecord, kind: NotesLeadAlertKind): Promise<void> {
  const { writeEvent } = await import("@/lib/analytics/server");
  await writeEvent({
    event_name: "notes_lead_telegram_alert_sent",
    dedupe_key: `notes_lead_telegram_alert_sent:${lead.id}:${kind}`,
    props: notesLeadAlertAnalytics(lead, kind),
  });
}
