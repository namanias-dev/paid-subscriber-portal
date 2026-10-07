/**
 * Guest checkout. Writes to store_* tables only.
 *
 * A customer row in store_customers is not an account: no login code, no
 * session, no entitlement. The academy buyer/student link is derived at read
 * time by phone_key and is never stored here, so it cannot drift.
 */
import { storeDb } from "./db";
import { makeStoreReference } from "./references";
import { buildStorePaymentUrl, storeSubMerchantId } from "./payments/eazypay";
import { pinPlaceConflict } from "./address";
import { addressFingerprint, canonicalDelivery } from "./deliveryAddress";
import { buildPickupQuote, lockQuote, persistQuoteLock, QUOTE_TTL_SECONDS, type FrozenQuote } from "./quote";
import { lookupIndianPincode } from "./serviceability";
import { activePickupLocation, snapshotPickupLocation } from "./pickupLocation";
import { pickupCreationEnabled } from "./pickupAvailability";
import { PICKUP_COPY, PickupCheckoutError, validatePickupCheckout, type PickupCheckoutBody } from "./pickupCheckoutRules";
import { pickupTaxSupported } from "./invoice/placeOfSupply";
import { normalizeIndiaState } from "@/lib/analytics/indiaStates";
import { reserveStock } from "./inventory";
import type { CartView } from "./cart";
import { cookies, headers } from "next/headers";
import { parseDevice } from "@/lib/analytics/server";
import { requestLeadAttribution } from "@/lib/marketing/requestAttribution";
import { SESSION_COOKIE, VISITOR_COOKIE } from "@/lib/attribution";
import { businessChannel } from "@/lib/analytics/notesCommerce";
import { hashStoreAccessToken, mintStoreAccessToken } from "./accessToken";
import { holdStoreOffer, offerTraceFromQuote, releaseStoreOfferHold } from "./offers";
import { couponSnapshot, holdDiscountForOrder, releaseDiscountForOrder, setCartDiscountCode } from "./discountCodes";
import { customerDiscountMessage, payTimeDiscountMessage, settledOrderMoney } from "./discountPricing";

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
  address_hash?: string;
}

export interface CheckoutResult {
  order_no: string;
  payment_url: string;
  promised_delivery_date: string | null;
  total_paise: number;
  /** Raw access token — set once as httpOnly cookie; never persist. */
  access_token: string;
}

function digits10(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  return d.slice(-10);
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
  const conflict = pinPlaceConflict(city, state, quote.city, quote.state);
  if (conflict) throw new Error(conflict);
  const canonical = canonicalDelivery({
    line1: address.line1,
    line2: address.line2,
    city,
    state,
    pincode: quote.pincode,
  });
  if (!address.address_hash || address.address_hash !== addressFingerprint(canonical)) {
    throw new Error("Confirm the delivery address before paying.");
  }

  const customerId = await upsertStoreCustomer(db, { phone, rawPhone: address.phone, name, email: address.email });

  const { data: addr, error: addrErr } = await db
    .from("store_addresses")
    .insert({
      customer_id: customerId,
      kind: "shipping",
      name,
      phone: address.phone.trim(),
      line1: canonical.line1,
      line2: canonical.line2,
      landmark: address.landmark?.trim() || null,
      city: canonical.city,
      state: canonical.state,
      pincode: quote.pincode,
      raw_line1: address.line1,
      raw_line2: address.line2 || null,
      raw_city: address.city,
      raw_state: address.state,
      confirmation_status: "CUSTOMER_CONFIRMED",
      confirmed_at: new Date().toISOString(),
      confirmed_by: "customer",
      verification_method: "pin_and_customer",
      address_hash: address.address_hash,
      delivery_instructions: address.delivery_instructions?.trim() || null,
    })
    .select("id")
    .single();
  if (addrErr || !addr) throw new Error(addrErr?.message || "could not save address");

  return createOrderFromQuote(db, cart, quote, {
    phone,
    rawPhone: address.phone,
    name,
    email: address.email,
    customerId,
    orderFields: {
      shipping_address_id: addr.id,
      billing_address_id: addr.id,
      promised_delivery_date: quote.promised_delivery_date,
    },
  });
}

/**
 * Academy Pickup checkout. Every check runs before the first write that matters:
 * creation flag, location record and acknowledged fingerprint, contact fields, PIN
 * location (no courier serviceability), priced lines and the pickup tax rule. Only
 * then is the cart claimed (open -> converted, conditional), so a double tap or a
 * second tab cannot create a second order. A later failure reopens the cart.
 */
export async function placePickupCheckout(cart: CartView, body: PickupCheckoutBody): Promise<CheckoutResult> {
  if (!(await pickupCreationEnabled())) throw new PickupCheckoutError(PICKUP_COPY.unavailable, "PICKUP_UNAVAILABLE", 409);
  const active = activePickupLocation();
  const contact = validatePickupCheckout(body, active);
  if (!active.ok) throw new PickupCheckoutError(PICKUP_COPY.unavailable, "PICKUP_UNAVAILABLE", 409);

  const located = await lookupIndianPincode(contact.pincode);
  if (!located.ok) {
    throw located.retriable
      ? new PickupCheckoutError(located.error, "PIN_LOOKUP_UNAVAILABLE", 503, "pincode")
      : new PickupCheckoutError(located.error, "INVALID_PIN", 400, "pincode");
  }
  const canonicalState = normalizeIndiaState(located.state);
  const location = {
    pincode: located.pincode,
    city: located.city.trim(),
    state: canonicalState.code === "unknown" ? located.state.trim() : canonicalState.name,
  };

  const quote = await buildPickupQuote(cart, location, active.location.code, "throw");
  if (!pickupTaxSupported(quote.items)) throw new PickupCheckoutError(PICKUP_COPY.taxUnsupported, "TAX_UNSUPPORTED", 409);

  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  await persistQuoteLock(cart.id, quote);

  const { data: claimed } = await db
    .from("store_carts")
    .update({ status: "converted", updated_at: new Date().toISOString() })
    .eq("id", cart.id)
    .eq("status", "open")
    .select("id");
  if (!claimed?.length) throw new PickupCheckoutError(PICKUP_COPY.alreadyPlacing, "ALREADY_PLACING", 409);

  const now = new Date();
  try {
    const customerId = await upsertStoreCustomer(db, { phone: contact.phone, rawPhone: contact.rawPhone, name: contact.name, email: contact.email });
    return await createOrderFromQuote(db, cart, quote, {
      phone: contact.phone,
      rawPhone: contact.rawPhone,
      name: contact.name,
      email: contact.email,
      customerId,
      orderFields: {
        fulfillment_method: "ACADEMY_PICKUP",
        pickup_location_code: active.location.code,
        pickup_location_snapshot: snapshotPickupLocation(active.location, now),
        pickup_acknowledged_at: now.toISOString(),
        customer_location_snapshot: {
          pincode: location.pincode,
          city: location.city,
          state: location.state,
          state_code: canonicalState.code === "unknown" ? null : canonicalState.code,
          country: "IN",
          source: located.source,
          captured_at: now.toISOString(),
        },
        shipping_address_id: null,
        billing_address_id: null,
        promised_delivery_date: null,
      },
      eventPayload: { fulfillment_method: "ACADEMY_PICKUP", pickup_location_code: active.location.code },
    });
  } catch (error) {
    // Let the customer try again from the same cart; any order row left behind is
    // already PAYMENT_FAILED (or PAYMENT_PENDING with no gateway hand-off, which Verify expires).
    await db.from("store_carts").update({ status: "open", updated_at: new Date().toISOString() }).eq("id", cart.id).eq("status", "converted");
    throw error;
  }
}

/** Upsert the store customer by phone_key. This is NOT an academy identity. */
async function upsertStoreCustomer(
  db: NonNullable<ReturnType<typeof storeDb>>,
  input: { phone: string; rawPhone: string; name: string; email?: string },
): Promise<string> {
  const { phone, name } = input;
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
      .update({ name, email: input.email || null, updated_at: new Date().toISOString() })
      .eq("id", customerId);
  } else {
    const { data: created, error } = await db
      .from("store_customers")
      .insert({ phone: input.rawPhone.trim(), name, email: input.email || null })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "could not save customer");
    customerId = created.id;
  }

  return customerId;
}

/**
 * Everything after the quote is locked and the method-specific checks have passed:
 * order number, order row, items, offer hold, stock hold, payment row, event, cart
 * conversion and lead/analytics hooks. Shared so delivery and pickup orders are
 * created by the same statements; only `orderFields` differs.
 */
async function createOrderFromQuote(
  db: NonNullable<ReturnType<typeof storeDb>>,
  cart: CartView,
  quote: FrozenQuote,
  input: {
    phone: string;
    rawPhone: string;
    name: string;
    email?: string;
    customerId: string;
    orderFields: Record<string, unknown>;
    eventPayload?: Record<string, unknown>;
  },
): Promise<CheckoutResult> {
  const { phone, name, customerId } = input;
  const { data: orderNoRow, error: noErr } = await db.rpc("next_store_order_no");
  if (noErr) throw new Error(noErr.message);
  const orderNo = String(orderNoRow || "");
  if (!orderNo.startsWith("NIAS-N-")) throw new Error("could not allocate an order number");

  const orderToken = mintStoreAccessToken();
  const orderTokenHash = hashStoreAccessToken(orderToken);
  // Freeze first-party nsa_attr at checkout — same cookie as academy leads, store tables only.
  const attr = requestLeadAttribution();
  const touch = attr.attribution?.last_touch || attr.attribution?.first_touch || null;
  let deviceCategory: string | null = null;
  let deviceBrowser: string | null = null;
  let deviceOs: string | null = null;
  try {
    const device = parseDevice(headers().get("user-agent"));
    deviceCategory = device.type;
    deviceBrowser = device.browser;
    deviceOs = device.os;
  } catch { /* device lookup must not block checkout */ }
  const attributionJson = {
    ...(attr.attribution || { first_touch: null, last_touch: null }),
    device_category: deviceCategory,
    device_browser: deviceBrowser,
    device_os: deviceOs,
  };
  const money = settledOrderMoney({
    subtotalPaise: quote.subtotal_paise,
    offerDiscountPaise: quote.discount_paise,
    couponDiscountPaise: quote.coupon_discount_paise || 0,
    taxPaise: quote.tax_paise,
    shippingPaise: quote.shipping_paise,
  });
  const trace = offerTraceFromQuote(quote) || {};
  const couponTrace = quote.coupon ? couponSnapshot(quote.coupon) : null;
  const orderInsert: Record<string, unknown> = {
      order_no: orderNo,
      status: "PAYMENT_PENDING",
      customer_id: customerId,
      cart_id: cart.id,
      customer_name: name,
      phone: input.rawPhone.trim(),
      email: input.email || null,
      ...input.orderFields,
      subtotal_paise: quote.subtotal_paise,
      discount_paise: money.discountPaise,
      shipping_paise: quote.shipping_paise,
      tax_paise: quote.tax_paise,
      total_paise: money.totalPaise,
      promo_code: quote.offer_slug || null,
      offer_id: quote.offer_id || null,
      discount_trace_json: couponTrace ? { ...trace, coupon: couponTrace } : offerTraceFromQuote(quote),
      quote_json: quote,
      tracking_token: null,
      tracking_token_hash: orderTokenHash,
      attribution_json: attributionJson,
      attribution_source: attr.utm_source || touch?.source || attr.channel,
      attribution_campaign: attr.utm_campaign,
      attribution_campaign_id: touch?.campaign_id || null,
      attribution_adset_id: touch?.adset_id || null,
      attribution_ad_id: touch?.ad_id || null,
      attribution_platform: businessChannel(touch),
  };
  if (quote.coupon_code && quote.coupon_discount_paise > 0) {
    orderInsert.coupon_code = quote.coupon_code;
    orderInsert.coupon_id = quote.coupon_id;
    orderInsert.coupon_discount_paise = quote.coupon_discount_paise;
    orderInsert.coupon_snapshot = couponTrace;
  }
  const { data: order, error: orderErr } = await db
    .from("store_orders")
    .insert(orderInsert)
    .select("id,order_no")
    .single();
  if (orderErr || !order) {
    if (quote.coupon_code && /coupon_/i.test(orderErr?.message || "")) {
      throw new Error(customerDiscountMessage("unavailable"));
    }
    throw new Error(orderErr?.message || "could not create order");
  }

  const itemRows = quote.items.map((i) => ({
    order_id: order.id,
    product_id: i.product_id,
    name_snapshot: i.name,
    sku_snapshot: i.sku,
    qty: i.qty,
    unit_price_paise: i.unit_price_paise,
    line_discount_paise: i.line_discount_paise || 0,
    line_total_paise: i.line_total_paise,
    tax_treatment_snapshot: i.tax_treatment,
    tax_rate_bps_snapshot: i.tax_rate_bps,
    tax_paise: i.tax_paise,
    hsn_snapshot: i.hsn,
    weight_grams_snapshot: i.weight_grams,
  }));
  const { error: itemsErr } = await db.from("store_order_items").insert(itemRows);
  if (itemsErr) throw new Error(itemsErr.message);

  if (quote.offer_id && quote.discount_paise > 0) {
    const held = await holdStoreOffer({
      offerId: quote.offer_id,
      orderId: order.id,
      ttlSeconds: QUOTE_TTL_SECONDS,
    });
    if (!held.ok) {
      await db.from("store_orders").update({ status: "PAYMENT_FAILED", updated_at: new Date().toISOString() }).eq("id", order.id);
      throw new Error("This offer is no longer available. Please review the updated price and try again.");
    }
  }

  if (quote.coupon && quote.coupon_discount_paise > 0) {
    const reserved = await holdDiscountForOrder({
      codeId: quote.coupon.id,
      orderId: order.id,
      phoneKey: phone,
      amountPaise: quote.coupon_discount_paise,
      customerId,
      couponCode: quote.coupon_code,
    });
    if (!reserved.ok) {
      await setCartDiscountCode(cart.id, null);
      await releaseStoreOfferHold(order.id);
      await db.from("store_orders").update({ status: "PAYMENT_FAILED", updated_at: new Date().toISOString() }).eq("id", order.id);
      throw new Error(payTimeDiscountMessage(reserved.reason || "invalid"));
    }
  }

  // Only ready_stock lines reserve/decrement inventory. on_demand titles are
  // printed per order and carry no stock counter, so they never reserve.
  const reservableItems = quote.items
    .filter((i) => i.availability_mode === "ready_stock")
    .map((i) => ({ product_id: i.product_id, qty: i.qty }));
  if (reservableItems.length) {
    const reserved = await reserveStock(reservableItems, {
      cartId: cart.id,
      orderId: order.id,
      ttlSeconds: QUOTE_TTL_SECONDS,
    });
    if (!reserved.ok) {
      await releaseDiscountForOrder(order.id);
      await db.from("store_orders").update({ status: "PAYMENT_FAILED", updated_at: new Date().toISOString() }).eq("id", order.id);
      const names = (reserved.shortfalls || []).map((s) => s.name).filter(Boolean).join(", ");
      throw new Error(names ? `Just sold out: ${names}` : "One of these titles just sold out. Refresh and try again.");
    }
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
  if (payErr) {
    await releaseDiscountForOrder(order.id);
    await db.from("store_orders").update({ status: "PAYMENT_FAILED", updated_at: new Date().toISOString() }).eq("id", order.id);
    throw new Error(payErr.message);
  }

  const paymentUrl = buildStorePaymentUrl({
    referenceNo,
    amountPaise: quote.total_paise,
    name,
    email: input.email?.trim() || `${phone}@namanias.invalid`,
    mobile: phone,
  });
  if (!paymentUrl) {
    await releaseDiscountForOrder(order.id);
    await db.from("store_orders").update({ status: "PAYMENT_FAILED", updated_at: new Date().toISOString() }).eq("id", order.id);
    throw new Error("Payment gateway is not configured");
  }

  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "checkout_started",
    to_status: "PAYMENT_PENDING",
    actor_type: "customer",
    payload_json: input.eventPayload
      ? { reference_no: referenceNo, total_paise: quote.total_paise, ...input.eventPayload }
      : { reference_no: referenceNo, total_paise: quote.total_paise },
  });

  await db.from("store_carts").update({ status: "converted", updated_at: new Date().toISOString() }).eq("id", cart.id);

  let visitorId: string | null = null;
  let sessionId: string | null = null;
  try {
    const jar = cookies();
    visitorId = jar.get(VISITOR_COOKIE)?.value || null;
    sessionId = jar.get(SESSION_COOKIE)?.value || null;
  } catch { /* analytics must not block payment */ }
  void import("@/lib/store/checkoutLeads")
    .then((m) => m.markLeadPaymentInitiated({
      phone,
      name,
      email: input.email,
      cartId: cart.id,
      orderId: order.id,
      totalPaise: quote.total_paise,
    }))
    .catch(() => {});
  void import("@/lib/analytics/notesPurchase")
    .then((m) => m.recordNotesPaymentInitiated({
      orderId: order.id,
      totalPaise: quote.total_paise,
      itemCount: quote.items.length,
      attribution: attr.attribution,
      visitorId,
      sessionId,
      couponCode: quote.coupon_code,
      couponDiscountPaise: quote.coupon_discount_paise || 0,
      productIds: quote.items.map((item) => item.product_id),
    }))
    .catch(() => {});

  return {
    order_no: order.order_no,
    payment_url: paymentUrl,
    promised_delivery_date: quote.promised_delivery_date,
    total_paise: quote.total_paise,
    access_token: orderToken,
  };
}


export function quoteTotal(quote: FrozenQuote): number {
  return quote.total_paise;
}
