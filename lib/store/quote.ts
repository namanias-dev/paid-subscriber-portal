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

/**
 * Compute the authoritative quote numbers from a cart and an already-resolved,
 * serviceable PIN — reading live product prices, stock and tax so the result is
 * exactly what capture will validate against. Does NOT persist. Both the real
 * checkout lock (`lockQuote`) and the read-only checkout preview (the PIN
 * endpoint) build on this, so the total a customer sees before paying is the
 * total we charge, to the paisa. Throws if a line is no longer buyable.
 */
export async function buildFrozenQuote(cart: CartView, pin: PinCheckResult): Promise<FrozenQuote> {
  if (!cart.items.length) throw new Error("Your cart is empty");
  if (!pin.serviceable) throw new Error("We don't currently deliver to this PIN code");

  const lines = await buildQuoteLines(cart);
  const shipping = pin.zone.shipping_paise;
  const now = new Date();
  return {
    cart_id: cart.id,
    items: lines.items,
    subtotal_paise: lines.subtotal_paise,
    discount_paise: lines.discount_paise,
    shipping_paise: shipping,
    tax_paise: lines.tax_paise,
    total_paise: lines.subtotal_paise - lines.discount_paise + lines.tax_paise + shipping,
    offer_id: lines.offer_id,
    offer_name: lines.offer_name,
    offer_slug: lines.offer_slug,
    discount_type: lines.discount_type,
    discount_value: lines.discount_value,
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
 * Academy Pickup quote: the same priced lines, shipping always 0, and no zone, courier
 * or serviceability input. The PIN is only where the customer is (invoice and records).
 */
export async function buildPickupQuote(cart: CartView, location: PickupQuoteLocation, locationCode: string): Promise<FrozenQuote> {
  if (!cart.items.length) throw new Error("Your cart is empty");
  const lines = await buildQuoteLines(cart);
  const now = new Date();
  return {
    cart_id: cart.id,
    items: lines.items,
    subtotal_paise: lines.subtotal_paise,
    discount_paise: lines.discount_paise,
    shipping_paise: 0,
    tax_paise: lines.tax_paise,
    total_paise: lines.subtotal_paise - lines.discount_paise + lines.tax_paise,
    offer_id: lines.offer_id,
    offer_name: lines.offer_name,
    offer_slug: lines.offer_slug,
    discount_type: lines.discount_type,
    discount_value: lines.discount_value,
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
  const quote = await buildPickupQuote(cart, location, locationCode);
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

  const quote = await buildFrozenQuote(cart, pin);

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
    items: (q.items || []).map((i) => ({ ...i, line_discount_paise: i.line_discount_paise || 0 })),
  };
}
