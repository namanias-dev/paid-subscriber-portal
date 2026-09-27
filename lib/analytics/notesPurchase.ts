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
  couponCode?: string | null;
  couponDiscountPaise?: number;
  productIds?: string[];
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
      ...(input.couponCode
        ? {
            coupon_code: input.couponCode,
            discount_amount: input.couponDiscountPaise || 0,
            product_ids: input.productIds || [],
          }
        : {}),
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
  let couponCode: string | null = null;
  let couponDiscount = 0;
  let cartBefore: number | null = null;
  try {
    const { data: couponRow, error } = await db
      .from("store_orders")
      .select("coupon_code,coupon_discount_paise,subtotal_paise,coupon_snapshot")
      .eq("id", orderId)
      .maybeSingle();
    if (!error && couponRow?.coupon_code) {
      couponCode = String(couponRow.coupon_code);
      couponDiscount = Number(couponRow.coupon_discount_paise) || 0;
      const snap = couponRow.coupon_snapshot as { merchandise_before_paise?: number } | null;
      cartBefore = snap?.merchandise_before_paise ?? (Number(couponRow.subtotal_paise) || null);
    }
  } catch {
    couponCode = null;
  }
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
      ...(couponCode
        ? {
            coupon_code: couponCode,
            discount_amount: couponDiscount,
            product_ids: safeItems.map((item) => item.product_id),
            cart_value_before: cartBefore,
            cart_value_after: Math.max(0, (cartBefore || 0) - couponDiscount),
          }
        : {}),
    },
  });
  if (!wrote) return false;
  if (couponCode) {
    await writeEvent({
      event_name: "notes_purchase_with_discount",
      dedupe_key: `notes_purchase_with_discount:${orderId}`,
      attribution: attr,
      props: {
        schema_version: NOTES_SCHEMA_VERSION,
        coupon_code: couponCode,
        discount_amount: couponDiscount,
        product_ids: safeItems.map((item) => item.product_id),
        cart_value_before: cartBefore,
        cart_value_after: Math.max(0, (cartBefore || 0) - couponDiscount),
        value_paise: order.total_paise,
        source: touch?.source || null,
        campaign: touch?.campaign || null,
        currency: "INR",
      },
    });
  }
  const valueInr = Number(order.total_paise || 0) / 100;
  await sendGa4NotesPurchase({
    orderId,
    orderNo: String(order.order_no),
    valueInr,
    coupon: couponCode,
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
    coupon: couponCode,
  });
  return true;
}
