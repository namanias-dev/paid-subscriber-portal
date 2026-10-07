/**
 * Quote lock. Capture validates against this, never against the live cart.
 *
 * Freezing items, prices, shipping, tax and total at checkout is what stops
 * price drift, a coupon expiring mid-handoff, and a last-copy selling out
 * between "Pay" and the gateway redirect. The TTL matches the inventory
 * reservation so the two cannot disagree about whether the order is still live.
 */
import { storeDb } from "./db";
import { lineTaxPaise } from "./money";
import { checkPincode, type PinCheckResult } from "./serviceability";
import { normalizeAvailabilityMode, type AvailabilityMode } from "./availability";
import type { CartView } from "./cart";
import { calculateStorePrice, type StoreOfferDiscountType } from "./pricing";
import { getActiveStoreOffer, toPricingOffer } from "./offers";
import { allocateDiscountPaise, customerDiscountMessage, settledOrderMoney } from "./discountPricing";
import { judgeCartDiscount, setCartDiscountCode, type AppliedDiscount } from "./discountCodes";

export const QUOTE_TTL_SECONDS = 15 * 60;

export interface QuoteLine {
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  unit_price_paise: number;
  mrp_paise: number;
  line_discount_paise: number;
  line_total_paise: number;
  tax_paise: number;
  tax_treatment: string;
  tax_rate_bps: number;
  weight_grams: number | null;
  dispatch_days: number;
  hsn: string | null;
  availability_mode: AvailabilityMode;
}

export interface FrozenQuote {
  cart_id: string;
  items: QuoteLine[];
  subtotal_paise: number;
  discount_paise: number;
  shipping_paise: number;
  tax_paise: number;
  total_paise: number;
  offer_id: string | null;
  offer_name: string | null;
  offer_slug: string | null;
  discount_type: StoreOfferDiscountType | null;
  discount_value: number | null;
  coupon_code: string | null;
  coupon_id: string | null;
  coupon_name: string | null;
  coupon_discount_type: "fixed_amount" | "percentage" | null;
  coupon_discount_value: number | null;
  coupon_discount_paise: number;
  coupon_eligible_product_ids: string[];
  coupon_notice: string | null;
  coupon: AppliedDiscount | null;
  pincode: string;
  city: string | null;
  state: string | null;
  zone: string;
  /** Delivery: the promised date. Academy Pickup makes no date promise (null). */
  promised_delivery_date: string | null;
  promised_label: string;
  locked_at: string;
  expires_at: string;
  /** Absent on quotes locked before Academy Pickup existed: those are DELIVERY. */
  fulfillment_method?: "DELIVERY" | "ACADEMY_PICKUP";
  pickup_location_code?: string | null;
}

export interface QuoteLines {
  items: QuoteLine[];
  subtotal_paise: number;
  discount_paise: number;
  tax_paise: number;
  offer_id: string | null;
  offer_name: string | null;
  offer_slug: string | null;
  discount_type: StoreOfferDiscountType | null;
  discount_value: number | null;
}

/** Customer location for an Academy Pickup quote: server-resolved from the PIN. */
export interface PickupQuoteLocation {
  pincode: string;
  city: string;
  state: string;
}

/**
 * Price every cart line from live product rows, stock and the active offer. Shared by
 * the delivery and Academy Pickup quotes so both charge identical line amounts.
 * Does NOT persist. Throws if a line is no longer buyable.
 */
export async function buildQuoteLines(cart: CartView): Promise<QuoteLines> {
  if (!cart.items.length) throw new Error("Your cart is empty");
  const db = storeDb();
  if (!db) throw new Error("store unavailable");

  const activeOfferRow = await getActiveStoreOffer();
  const offer = activeOfferRow ? toPricingOffer(activeOfferRow) : null;

  const items: QuoteLine[] = [];
  for (const it of cart.items) {
    const { data: live } = await db
      .from("store_products")
      .select("id,sku,name,kind,category_id,selling_price_paise,mrp_paise,on_hand,reserved,is_active,availability_mode,tax_treatment,tax_rate_bps,weight_grams,dispatch_days,hsn_code,max_quantity_per_order")
      .eq("id", it.product_id)
      .maybeSingle();
    if (!live || !live.is_active) throw new Error(`${it.product.name} is no longer available`);
    const mode = normalizeAvailabilityMode(live.availability_mode);
    if (mode === "coming_soon" || mode === "unavailable") {
      throw new Error(`${live.name} is not available to order right now`);
    }
    // Stock is authoritative only for ready_stock; on_demand has no stock ceiling.
    if (mode === "ready_stock") {
      const sellable = Math.max(0, Number(live.on_hand) - Number(live.reserved));
      if (sellable < it.qty) throw new Error(`${live.name} has only ${sellable} left`);
    }
    const priced = calculateStorePrice(
      {
        id: live.id,
        kind: live.kind === "bundle" ? "bundle" : "single",
        category_id: live.category_id || null,
        selling_price_paise: Number(live.selling_price_paise),
      },
      it.qty,
      offer,
    );
    const tax = lineTaxPaise(priced.final_paise, live.tax_treatment, live.tax_rate_bps);
    items.push({
      product_id: live.id,
      sku: live.sku,
      name: live.name,
      qty: it.qty,
      unit_price_paise: priced.base_unit_paise,
      mrp_paise: Number(live.mrp_paise),
      line_discount_paise: priced.discount_paise,
      line_total_paise: priced.final_paise,
      tax_paise: tax,
      tax_treatment: live.tax_treatment,
      tax_rate_bps: live.tax_rate_bps,
      weight_grams: live.weight_grams,
      dispatch_days: live.dispatch_days,
      hsn: live.hsn_code,
      availability_mode: mode,
    });
  }

  const subtotal = items.reduce((s, i) => s + i.unit_price_paise * i.qty, 0);
  const discount = items.reduce((s, i) => s + i.line_discount_paise, 0);
  const tax = items.reduce((s, i) => s + i.tax_paise, 0);
  const applied = items.find((i) => i.line_discount_paise > 0);
  return {
    items,
    subtotal_paise: subtotal,
    discount_paise: discount,
    tax_paise: tax,
    offer_id: applied && offer ? offer.id : null,
    offer_name: applied && offer ? offer.name : null,
    offer_slug: applied && offer ? offer.slug : null,
    discount_type: applied && offer ? offer.discount_type : null,
    discount_value: applied && offer ? offer.discount_value : null,
  };
}

function couponFields(applied: AppliedDiscount | null, notice: string | null) {
  return {
    coupon_code: applied?.code || null,
    coupon_id: applied?.id || null,
    coupon_name: applied?.name || null,
    coupon_discount_type: applied?.discount_type || null,
    coupon_discount_value: applied?.discount_value ?? null,
    coupon_discount_paise: applied?.discount_paise || 0,
    coupon_eligible_product_ids: applied?.eligible_product_ids || [],
    coupon_notice: notice,
    coupon: applied,
  };
}

/**
 * Apply a stored cart discount code to already-priced lines, recompute per-line
 * tax after the coupon reduction, and settle the money. Shared by the delivery
 * and Academy Pickup quotes so a valid code lowers the charge either way.
 *
 * `throw` refuses to settle when a stored code is no longer valid, so Pay cannot
 * charge a different total than the one the customer just saw. `omit` is the
 * preview: the discount drops off and the notice explains why.
 */
async function settleCouponedQuote(
  cart: CartView,
  lines: QuoteLines,
  shippingPaise: number,
  mode: "throw" | "omit",
): Promise<{
  items: QuoteLine[];
  tax_paise: number;
  total_paise: number;
  couponApplied: AppliedDiscount | null;
  couponNotice: string | null;
}> {
  const items = lines.items.map((i) => ({ ...i }));
  let couponApplied: AppliedDiscount | null = null;
  let couponNotice: string | null = null;
  if (cart.discount_code) {
    const judged = await judgeCartDiscount({
      rawCode: cart.discount_code,
      lines: items.map((item) => ({ product_id: item.product_id, merchandise_paise: item.line_total_paise })),
    });
    if (!judged.applied) {
      const message = judged.reason === "not_applicable"
        ? customerDiscountMessage("not_applicable", cart.discount_code)
        : judged.message || customerDiscountMessage(judged.reason || "invalid");
      await setCartDiscountCode(cart.id, null);
      if (mode === "throw") throw new Error(message);
      couponNotice = message;
    } else {
      couponApplied = judged.applied;
    }
  }
  const allocation = couponApplied
    ? allocateDiscountPaise(
      items
        .filter((item) => couponApplied.eligible_product_ids.includes(item.product_id))
        .map((item) => ({ product_id: item.product_id, merchandise_paise: item.line_total_paise })),
      couponApplied.discount_paise,
    )
    : {};
  for (const item of items) {
    const reduced = Math.max(0, item.line_total_paise - (allocation[item.product_id] || 0));
    item.tax_paise = lineTaxPaise(reduced, item.tax_treatment, item.tax_rate_bps);
  }
  const tax = items.reduce((sum, item) => sum + item.tax_paise, 0);
  const money = settledOrderMoney({
    subtotalPaise: lines.subtotal_paise,
    offerDiscountPaise: lines.discount_paise,
    couponDiscountPaise: couponApplied?.discount_paise || 0,
    taxPaise: tax,
    shippingPaise,
  });
  return { items, tax_paise: tax, total_paise: money.totalPaise, couponApplied, couponNotice };
}

/**
 * Compute the authoritative quote numbers from a cart and an already-resolved,
 * serviceable PIN — reading live product prices, stock and tax so the result is
 * exactly what capture will validate against. Does NOT persist. Both the real
 * checkout lock (`lockQuote`) and the read-only checkout preview (the PIN
 * endpoint) build on this, so the total a customer sees before paying is the
 * total we charge, to the paisa. Throws if a line is no longer buyable.
 */
export async function buildFrozenQuote(
  cart: CartView,
  pin: PinCheckResult,
  mode: "throw" | "omit" = "omit",
): Promise<FrozenQuote> {
  if (!cart.items.length) throw new Error("Your cart is empty");
  if (!pin.serviceable) throw new Error("We don't currently deliver to this PIN code");

  const lines = await buildQuoteLines(cart);
  const shipping = pin.zone.shipping_paise;
  const settled = await settleCouponedQuote(cart, lines, shipping, mode);
  const now = new Date();
  return {
    cart_id: cart.id,
    items: settled.items,
    subtotal_paise: lines.subtotal_paise,
    discount_paise: lines.discount_paise,
    shipping_paise: shipping,
    tax_paise: settled.tax_paise,
    total_paise: settled.total_paise,
    offer_id: lines.offer_id,
    offer_name: lines.offer_name,
    offer_slug: lines.offer_slug,
    discount_type: lines.discount_type,
    discount_value: lines.discount_value,
    ...couponFields(settled.couponApplied, settled.couponNotice),
    pincode: pin.pincode,
    city: pin.city,
    state: pin.state,
    zone: pin.zone.zone,
    promised_delivery_date: pin.promised_date,
    promised_label: pin.promised_label,
    locked_at: now.toISOString(),
    expires_at: new Date(now.getTime() + QUOTE_TTL_SECONDS * 1000).toISOString(),
  };
}

/**
 * Academy Pickup quote: the same priced lines (coupons included), shipping always
 * 0, and no zone, courier or serviceability input. The PIN is only where the
 * customer is (invoice and records).
 */
export async function buildPickupQuote(
  cart: CartView,
  location: PickupQuoteLocation,
  locationCode: string,
  mode: "throw" | "omit" = "omit",
): Promise<FrozenQuote> {
  if (!cart.items.length) throw new Error("Your cart is empty");
  const lines = await buildQuoteLines(cart);
  const settled = await settleCouponedQuote(cart, lines, 0, mode);
  const now = new Date();
  return {
    cart_id: cart.id,
    items: settled.items,
    subtotal_paise: lines.subtotal_paise,
    discount_paise: lines.discount_paise,
    shipping_paise: 0,
    tax_paise: settled.tax_paise,
    total_paise: settled.total_paise,
    offer_id: lines.offer_id,
    offer_name: lines.offer_name,
    offer_slug: lines.offer_slug,
    discount_type: lines.discount_type,
    discount_value: lines.discount_value,
    ...couponFields(settled.couponApplied, settled.couponNotice),
    pincode: location.pincode,
    city: location.city,
    state: location.state,
    zone: "ACADEMY_PICKUP",
    promised_delivery_date: null,
    promised_label: "Academy pickup",
    locked_at: now.toISOString(),
    expires_at: new Date(now.getTime() + QUOTE_TTL_SECONDS * 1000).toISOString(),
    fulfillment_method: "ACADEMY_PICKUP",
    pickup_location_code: locationCode,
  };
}

export async function persistQuoteLock(cartId: string, quote: FrozenQuote): Promise<void> {
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  await db
    .from("store_carts")
    .update({
      quote_json: quote,
      quote_locked_at: quote.locked_at,
      quote_expires_at: quote.expires_at,
      updated_at: quote.locked_at,
    })
    .eq("id", cartId);
}

export async function lockPickupQuote(cart: CartView, location: PickupQuoteLocation, locationCode: string): Promise<FrozenQuote> {
  const quote = await buildPickupQuote(cart, location, locationCode, "throw");
  await persistQuoteLock(cart.id, quote);
  return quote;
}

export async function lockQuote(cart: CartView, pincode: string): Promise<FrozenQuote> {
  if (!cart.items.length) throw new Error("Your cart is empty");
  const pin = await checkPincode(pincode, cart.max_dispatch_days);
  if ("error" in pin) throw new Error(pin.error);
  if (!pin.serviceable) throw new Error("We don't currently deliver to this PIN code");

  const db = storeDb();
  if (!db) throw new Error("store unavailable");

  const quote = await buildFrozenQuote(cart, pin, "throw");

  await db
    .from("store_carts")
    .update({
      quote_json: quote,
      quote_locked_at: quote.locked_at,
      quote_expires_at: quote.expires_at,
      updated_at: quote.locked_at,
    })
    .eq("id", cart.id);

  return quote;
}

export async function readLockedQuote(cartId: string): Promise<FrozenQuote | null> {
  const db = storeDb();
  if (!db) return null;
  const { data } = await db
    .from("store_carts")
    .select("quote_json,quote_expires_at")
    .eq("id", cartId)
    .maybeSingle();
  if (!data?.quote_json) return null;
  if (data.quote_expires_at && new Date(data.quote_expires_at).getTime() < Date.now()) return null;
  const q = data.quote_json as FrozenQuote;
  return {
    ...q,
    discount_paise: q.discount_paise || 0,
    offer_id: q.offer_id ?? null,
    offer_name: q.offer_name ?? null,
    offer_slug: q.offer_slug ?? null,
    discount_type: q.discount_type ?? null,
    discount_value: q.discount_value ?? null,
    coupon_code: q.coupon_code ?? null,
    coupon_id: q.coupon_id ?? null,
    coupon_name: q.coupon_name ?? null,
    coupon_discount_type: q.coupon_discount_type ?? null,
    coupon_discount_value: q.coupon_discount_value ?? null,
    coupon_discount_paise: q.coupon_discount_paise || 0,
    coupon_eligible_product_ids: q.coupon_eligible_product_ids || [],
    coupon_notice: q.coupon_notice ?? null,
    coupon: q.coupon ?? null,
    items: (q.items || []).map((i) => ({ ...i, line_discount_paise: i.line_discount_paise || 0 })),
  };
}
