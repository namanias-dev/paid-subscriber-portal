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

export const QUOTE_TTL_SECONDS = 15 * 60;

export interface QuoteLine {
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  unit_price_paise: number;
  mrp_paise: number;
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
  pincode: string;
  city: string | null;
  state: string | null;
  zone: string;
  promised_delivery_date: string;
  promised_label: string;
  locked_at: string;
  expires_at: string;
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

  const db = storeDb();
  if (!db) throw new Error("store unavailable");

  const items: QuoteLine[] = [];
  for (const it of cart.items) {
    const { data: live } = await db
      .from("store_products")
      .select("id,sku,name,selling_price_paise,mrp_paise,on_hand,reserved,is_active,availability_mode,tax_treatment,tax_rate_bps,weight_grams,dispatch_days,hsn_code,max_quantity_per_order")
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
    const unit = Number(live.selling_price_paise);
    const line = unit * it.qty;
    const tax = lineTaxPaise(line, live.tax_treatment, live.tax_rate_bps);
    items.push({
      product_id: live.id,
      sku: live.sku,
      name: live.name,
      qty: it.qty,
      unit_price_paise: unit,
      mrp_paise: Number(live.mrp_paise),
      line_total_paise: line,
      tax_paise: tax,
      tax_treatment: live.tax_treatment,
      tax_rate_bps: live.tax_rate_bps,
      weight_grams: live.weight_grams,
      dispatch_days: live.dispatch_days,
      hsn: live.hsn_code,
      availability_mode: mode,
    });
  }

  const subtotal = items.reduce((s, i) => s + i.line_total_paise, 0);
  const tax = items.reduce((s, i) => s + i.tax_paise, 0);
  const shipping = pin.zone.shipping_paise;
  const now = new Date();
  return {
    cart_id: cart.id,
    items,
    subtotal_paise: subtotal,
    discount_paise: 0,
    shipping_paise: shipping,
    tax_paise: tax,
    total_paise: subtotal + tax + shipping,
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
  return data.quote_json as FrozenQuote;
}
