/**
 * Guest checkout. Writes to store_* tables only.
 *
 * A customer row in store_customers is not an account: no login code, no
 * session, no entitlement. The academy buyer/student link is derived at read
 * time by phone_key and is never stored here, so it cannot drift.
 */
import { randomBytes } from "node:crypto";
import { storeDb } from "./db";
import { makeStoreReference } from "./references";
import { buildStorePaymentUrl, storeSubMerchantId } from "./payments/eazypay";
import { lockQuote, QUOTE_TTL_SECONDS, type FrozenQuote } from "./quote";
import { reserveStock } from "./inventory";
import type { CartView } from "./cart";

export interface CheckoutAddress {
  name: string;
  phone: string;
  email?: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  delivery_instructions?: string;
}

export interface CheckoutResult {
  order_no: string;
  payment_url: string;
  promised_delivery_date: string;
  total_paise: number;
}

function digits10(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  return d.slice(-10);
}

function trackingToken(): string {
  return randomBytes(18).toString("base64url");
}

export async function placeCheckout(cart: CartView, address: CheckoutAddress): Promise<CheckoutResult> {
  const phone = digits10(address.phone);
  if (phone.length !== 10) throw new Error("Enter a 10-digit mobile number");
  const name = address.name.trim();
  if (name.length < 2) throw new Error("Enter the recipient's full name");
  if (!address.line1.trim()) throw new Error("Enter address line 1");

  const quote = await lockQuote(cart, address.pincode);
  const db = storeDb();
  if (!db) throw new Error("store unavailable");

  const city = address.city.trim() || quote.city || "";
  const state = address.state.trim() || quote.state || "";
  if (!city || !state) throw new Error("Enter city and state");

  // Upsert the store customer by phone_key. This is NOT an academy identity.
  const { data: existing } = await db
    .from("store_customers")
    .select("id")
    .eq("phone_key", phone)
    .maybeSingle();

  let customerId: string;
  if (existing) {
    customerId = existing.id;
    await db
      .from("store_customers")
      .update({ name, email: address.email || null, updated_at: new Date().toISOString() })
      .eq("id", customerId);
  } else {
    const { data: created, error } = await db
      .from("store_customers")
      .insert({ phone: address.phone.trim(), name, email: address.email || null })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "could not save customer");
    customerId = created.id;
  }

  const { data: addr, error: addrErr } = await db
    .from("store_addresses")
    .insert({
      customer_id: customerId,
      kind: "shipping",
      name,
      phone: address.phone.trim(),
      line1: address.line1.trim(),
      line2: address.line2?.trim() || null,
      landmark: address.landmark?.trim() || null,
      city,
      state,
      pincode: quote.pincode,
      delivery_instructions: address.delivery_instructions?.trim() || null,
    })
    .select("id")
    .single();
  if (addrErr || !addr) throw new Error(addrErr?.message || "could not save address");

  const { data: orderNoRow, error: noErr } = await db.rpc("next_store_order_no");
  if (noErr) throw new Error(noErr.message);
  const orderNo = String(orderNoRow || "");
  if (!orderNo.startsWith("NIAS-N-")) throw new Error("could not allocate an order number");

  const { data: order, error: orderErr } = await db
    .from("store_orders")
    .insert({
      order_no: orderNo,
      status: "PAYMENT_PENDING",
      customer_id: customerId,
      cart_id: cart.id,
      customer_name: name,
      phone: address.phone.trim(),
      email: address.email || null,
      shipping_address_id: addr.id,
      billing_address_id: addr.id,
      subtotal_paise: quote.subtotal_paise,
      discount_paise: quote.discount_paise,
      shipping_paise: quote.shipping_paise,
      tax_paise: quote.tax_paise,
      total_paise: quote.total_paise,
      quote_json: quote,
      promised_delivery_date: quote.promised_delivery_date,
      tracking_token: trackingToken(),
    })
    .select("id,order_no")
    .single();
  if (orderErr || !order) throw new Error(orderErr?.message || "could not create order");

  const itemRows = quote.items.map((i) => ({
    order_id: order.id,
    product_id: i.product_id,
    name_snapshot: i.name,
    sku_snapshot: i.sku,
    qty: i.qty,
    unit_price_paise: i.unit_price_paise,
    line_total_paise: i.line_total_paise,
    tax_treatment_snapshot: i.tax_treatment,
    tax_rate_bps_snapshot: i.tax_rate_bps,
    tax_paise: i.tax_paise,
    hsn_snapshot: i.hsn,
    weight_grams_snapshot: i.weight_grams,
  }));
  const { error: itemsErr } = await db.from("store_order_items").insert(itemRows);
  if (itemsErr) throw new Error(itemsErr.message);

  const reserved = await reserveStock(
    quote.items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
    { cartId: cart.id, orderId: order.id, ttlSeconds: QUOTE_TTL_SECONDS },
  );
  if (!reserved.ok) {
    await db.from("store_orders").update({ status: "PAYMENT_FAILED", updated_at: new Date().toISOString() }).eq("id", order.id);
    const names = (reserved.shortfalls || []).map((s) => s.name).filter(Boolean).join(", ");
    throw new Error(names ? `Just sold out: ${names}` : "One of these titles just sold out. Refresh and try again.");
  }

  const referenceNo = makeStoreReference();
  const { error: payErr } = await db.from("store_order_payments").insert({
    order_id: order.id,
    reference_no: referenceNo,
    sub_merchant_id: storeSubMerchantId(),
    amount_paise: quote.total_paise,
    status: "INITIATED",
    next_verify_at: new Date(Date.now() + 2 * 60_000).toISOString(),
  });
  if (payErr) throw new Error(payErr.message);

  const paymentUrl = buildStorePaymentUrl({
    referenceNo,
    amountPaise: quote.total_paise,
    name,
    email: address.email?.trim() || `${phone}@namanias.invalid`,
    mobile: phone,
  });
  if (!paymentUrl) throw new Error("Payment gateway is not configured");

  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "checkout_started",
    to_status: "PAYMENT_PENDING",
    actor_type: "customer",
    payload_json: { reference_no: referenceNo, total_paise: quote.total_paise },
  });

  await db.from("store_carts").update({ status: "converted", updated_at: new Date().toISOString() }).eq("id", cart.id);

  return {
    order_no: order.order_no,
    payment_url: paymentUrl,
    promised_delivery_date: quote.promised_delivery_date,
    total_paise: quote.total_paise,
  };
}

export function quoteTotal(quote: FrozenQuote): number {
  return quote.total_paise;
}
