/**
 * Loads the facts buildAndValidateNotes*Sms decides on. Read-only. Any read
 * error throws: "could not read" must never be mistaken for "eligible".
 */
import { NOTES_APPROVED_TEMPLATES, notesApprovedByKey, type NotesApprovedTemplate, type NotesTemplateKey } from "@/lib/sms/notesApproved";
import { getTemplate, listNotesSmsLogs } from "@/lib/sms/store";
import { storeDb } from "../db";
import { getDiscountCodeByCode } from "../discountCodes";
import { normalizeIndianMobile } from "../checkoutLeadLogic";
import {
  buildAndValidateNotesLeadSms,
  buildAndValidateNotesOrderSms,
  type NotesLeadFacts,
  type NotesOrderFacts,
  type NotesPaymentFacts,
  type NotesPriorSms,
  type NotesSiblingOrder,
  type NotesSmsPlan,
  type NotesTemplateContext,
} from "./plan";

const HISTORY_DAYS = 30;
export const NOTES500_CODE = "NOTES500";
const NOTES500_PAISE = 50_000;

function db() {
  const client = storeDb();
  if (!client) throw new Error("notes_sms_db_unavailable");
  return client;
}

/** Null when NOTES500 is live and worth exactly Rs.500; otherwise why not. */
export async function notes500Problem(now = new Date()): Promise<string | null> {
  const code = await getDiscountCodeByCode(NOTES500_CODE);
  if (!code) return "missing";
  if (code.archived_at) return "archived";
  if (code.expires_at && new Date(code.expires_at).getTime() <= now.getTime()) return "expired";
  if (!code.is_active) return "inactive";
  if (code.starts_at && new Date(code.starts_at).getTime() > now.getTime()) return "scheduled";
  if (code.discount_type !== "fixed_amount" || Number(code.discount_value) !== NOTES500_PAISE) return "value_mismatch";
  if (code.max_redemptions != null && code.redemption_count + code.held_count >= code.max_redemptions) return "exhausted";
  return null;
}

export async function loadTemplateContext(t: NotesApprovedTemplate, now = new Date()): Promise<NotesTemplateContext> {
  const row = await getTemplate(t.id);
  const ctx: NotesTemplateContext = { row };
  if (t.key === "NOTES_DISCOUNT_NOTES500_01") ctx.promoCodeProblem = await notes500Problem(now);
  return ctx;
}

export async function loadNotesHistory(digits10: string | null, now = new Date()): Promise<NotesPriorSms[]> {
  if (!digits10) return [];
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString();
  const rows = await listNotesSmsLogs({
    templateIds: NOTES_APPROVED_TEMPLATES.map((t) => t.id),
    mobiles: [digits10],
    sinceIso: since,
  });
  return rows.map((r) => ({ template_id: r.template_id, status: r.status, created_at: r.created_at, dedupe_key: r.dedupe_key }));
}

export async function loadOrdersForPhone(phoneKey: string | null): Promise<NotesSiblingOrder[]> {
  if (!phoneKey) return [];
  const { data, error } = await db()
    .from("store_orders")
    .select("id,status,created_at,paid_at")
    .eq("phone_key", phoneKey)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`notes_sms_orders_read_failed: ${error.message}`);
  return (data || []) as NotesSiblingOrder[];
}

const ORDER_COLS =
  "id,order_no,status,phone,phone_key,customer_name,total_paise,amount_paid_paise,amount_refunded_paise,paid_at,created_at";

export interface LoadedOrderPlan {
  plan: NotesSmsPlan;
  order: NotesOrderFacts | null;
}

export async function loadOrderPlan(templateKey: NotesTemplateKey, orderId: string, now = new Date()): Promise<LoadedOrderPlan> {
  const t = notesApprovedByKey(templateKey);
  if (!t) throw new Error(`unknown Notes template ${templateKey}`);
  const client = db();
  const { data: orderRow, error } = await client.from("store_orders").select(ORDER_COLS).eq("id", orderId).maybeSingle();
  if (error) throw new Error(`notes_sms_order_read_failed: ${error.message}`);
  const order = (orderRow as NotesOrderFacts | null) || null;

  let items: { sku: string | null; qty: number }[] = [];
  let payments: NotesPaymentFacts[] = [];
  let siblings: NotesSiblingOrder[] = [];
  let history: NotesPriorSms[] = [];
  if (order) {
    const [itemsRes, paysRes] = await Promise.all([
      client.from("store_order_items").select("sku_snapshot,qty").eq("order_id", order.id),
      client.from("store_order_payments").select("id,status,amount_paise,captured_at,created_at").eq("order_id", order.id),
    ]);
    if (itemsRes.error) throw new Error(`notes_sms_items_read_failed: ${itemsRes.error.message}`);
    if (paysRes.error) throw new Error(`notes_sms_payments_read_failed: ${paysRes.error.message}`);
    items = (itemsRes.data || []).map((r: { sku_snapshot: string | null; qty: number }) => ({ sku: r.sku_snapshot, qty: Number(r.qty) }));
    payments = (paysRes.data || []).map((p: NotesPaymentFacts) => ({ ...p, amount_paise: Number(p.amount_paise) }));
    [siblings, history] = await Promise.all([
      loadOrdersForPhone(order.phone_key),
      loadNotesHistory(normalizeIndianMobile(order.phone), now),
    ]);
  }
  const ctx = await loadTemplateContext(t, now);
  const plan = buildAndValidateNotesOrderSms({ templateKey, ctx, order, items, payments, siblings, history, now });
  return { plan, order };
}

const LEAD_COLS =
  "id,phone,phone_key,checkout_stage,sales_status,marketing_consent,order_id,is_test,redacted_at,last_activity_at,created_at";

export interface LoadedLeadPlan {
  plan: NotesSmsPlan;
  lead: NotesLeadFacts | null;
}

export async function loadCheckoutLeadPlan(templateKey: NotesTemplateKey, leadId: string, now = new Date()): Promise<LoadedLeadPlan> {
  const t = notesApprovedByKey(templateKey);
  if (!t) throw new Error(`unknown Notes template ${templateKey}`);
  const { data, error } = await db().from("store_checkout_leads").select(LEAD_COLS).eq("id", leadId).maybeSingle();
  if (error) throw new Error(`notes_sms_lead_read_failed: ${error.message}`);
  const lead = (data as NotesLeadFacts | null) || null;
  const [phoneOrders, history] = lead
    ? await Promise.all([loadOrdersForPhone(lead.phone_key), loadNotesHistory(normalizeIndianMobile(lead.phone), now)])
    : [[], []];
  const ctx = await loadTemplateContext(t, now);
  const plan = buildAndValidateNotesLeadSms({ templateKey, ctx, lead, phoneOrders, history, now });
  return { plan, lead };
}
