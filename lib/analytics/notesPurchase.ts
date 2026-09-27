/**
 * Server-authoritative Notes purchase and payment events.
 * A repeated callback, browser refresh, or verify sweep hits the same dedupe key.
 * Never includes phone, email, or address.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import type { AttributionState } from "@/lib/attribution";
import { writeEvent } from "./server";
import { sendNotesMetaPurchase } from "./thirdParty";
import { sendGa4NotesPurchase } from "./ga4mp";
import {
  NOTES_SCHEMA_VERSION,
  businessChannel,
  isQaTouch,
  notesPaymentFailDedupeKey,
  notesPaymentInitDedupeKey,
  notesPurchaseDedupeKey,
} from "./notesCommerce";

function touchOf(state: AttributionState | null) {
  return state?.last_touch || state?.first_touch || null;
}

export async function recordNotesPaymentInitiated(input: {
  orderId: string;
  totalPaise: number;
  itemCount: number;
  attribution?: AttributionState | null;
  visitorId?: string | null;
  sessionId?: string | null;
}): Promise<void> {
  const touch = touchOf(input.attribution || null);
  await writeEvent({
    event_name: "notes_payment_initiated",
    visitor_id: input.visitorId,
    session_id: input.sessionId,
    dedupe_key: notesPaymentInitDedupeKey(input.orderId),
    attribution: input.attribution || null,
    props: {
      schema_version: NOTES_SCHEMA_VERSION,
      value_paise: input.totalPaise,
      item_count: input.itemCount,
      currency: "INR",
      source: touch?.source || null,
      medium: touch?.medium || null,
      campaign: touch?.campaign || null,
      content: touch?.content || null,
      channel: businessChannel(touch),
      is_test: isQaTouch(touch),
    },
  });
}

export async function recordNotesPaymentFailed(orderId: string, outcome: string): Promise<void> {
  await writeEvent({
    event_name: "notes_payment_failed",
    dedupe_key: notesPaymentFailDedupeKey(orderId, outcome),
    props: { schema_version: NOTES_SCHEMA_VERSION, outcome, recoverable: outcome !== "expired" },
  });
}

export async function recordNotesPurchase(orderId: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data: order } = await db
    .from("store_orders")
    .select("id,order_no,total_paise,discount_paise,shipping_paise,promo_code,attribution_json,paid_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!order?.paid_at || !order.order_no) return false;
  const { data: items } = await db
    .from("store_order_items")
    .select("product_id,name_snapshot,sku_snapshot,qty,unit_price_paise")
    .eq("order_id", orderId);
  const attr = (order.attribution_json || null) as AttributionState | null;
  const touch = touchOf(attr);
  const safeItems = (items || []).map((item) => ({
    product_id: item.product_id,
    sku: item.sku_snapshot,
    product_name: item.name_snapshot,
    quantity: item.qty,
    price_paise: item.unit_price_paise,
  }));
  const wrote = await writeEvent({
    event_name: "notes_purchase",
    dedupe_key: notesPurchaseDedupeKey(orderId),
    attribution: attr,
    props: {
      schema_version: NOTES_SCHEMA_VERSION,
      order_no: order.order_no,
      value_paise: order.total_paise,
      discount_paise: order.discount_paise,
      shipping_paise: order.shipping_paise,
      promo_code: order.promo_code,
      currency: "INR",
      source: touch?.source || null,
      medium: touch?.medium || null,
      campaign: touch?.campaign || null,
      content: touch?.content || null,
      channel: businessChannel(touch),
      is_test: isQaTouch(touch),
      items: safeItems,
    },
  });
  if (!wrote) return false;
  const valueInr = Number(order.total_paise || 0) / 100;
  await sendGa4NotesPurchase({
    orderId,
    orderNo: String(order.order_no),
    valueInr,
    items: safeItems.map((item) => ({
      item_id: String(item.sku || item.product_id || "notes"),
      item_name: String(item.product_name || "UPSC Notes").slice(0, 80),
      price: Number(item.price_paise || 0) / 100,
      quantity: Number(item.quantity || 1),
    })),
  });
  await sendNotesMetaPurchase({
    orderId,
    orderNo: String(order.order_no),
    valueInr,
    fbc: touch?.fbc,
    fbp: touch?.fbp,
    contentName: safeItems.map((item) => item.product_name).filter(Boolean).join(", ").slice(0, 80) || "UPSC Notes",
  });
  return true;
}
