/**
 * Notes Store pricing — single source of truth for promotional math.
 *
 * Money is INTEGER PAISE. No floats. Display and the gateway read these
 * integers; they never invent a second total.
 *
 * The customer-facing regular price lives on `store_products.selling_price_paise`
 * (inclusive GST when tax_treatment is not a separate add-on). An offer, if
 * any, is applied here — never in a React component.
 */
export type StoreOfferDiscountType = "percentage" | "fixed_amount";
export type StoreOfferScope =
  | "individual_subjects"
  | "all_products"
  | "specific_products"
  | "specific_categories"
  | "bundles";

export interface OfferForPricing {
  id: string;
  name: string;
  slug: string;
  discount_type: StoreOfferDiscountType;
  discount_value: number;
  scope: StoreOfferScope;
  product_ids: string[];
  category_ids: string[];
  badge_text?: string | null;
}

export interface PriceableProduct {
  id: string;
  kind: "single" | "bundle";
  category_id: string | null;
  selling_price_paise: number;
}

export interface PricedLine {
  product_id: string;
  qty: number;
  base_unit_paise: number;
  base_paise: number;
  discount_paise: number;
  final_paise: number;
  unit_final_paise: number;
  offer_id: string | null;
  offer_name: string | null;
  offer_slug: string | null;
  discount_type: StoreOfferDiscountType | null;
  discount_value: number | null;
}

export interface CartPricing {
  subtotal_paise: number;
  discount_paise: number;
  lines: PricedLine[];
  offer_id: string | null;
  offer_name: string | null;
  offer_slug: string | null;
  discount_type: StoreOfferDiscountType | null;
  discount_value: number | null;
}

export function productEligibleForOffer(
  product: PriceableProduct,
  offer: OfferForPricing | null | undefined,
): boolean {
  if (!offer) return false;
  switch (offer.scope) {
    case "all_products":
      return true;
    case "individual_subjects":
      return product.kind === "single";
    case "bundles":
      return product.kind === "bundle";
    case "specific_products":
      return offer.product_ids.includes(product.id);
    case "specific_categories":
      return !!product.category_id && offer.category_ids.includes(product.category_id);
    default:
      return false;
  }
}

/** Percentage of a paise amount, rounded to the nearest paisa. Never exceeds base. */
export function percentageDiscountPaise(basePaise: number, percent: number): number {
  if (!Number.isFinite(basePaise) || basePaise <= 0) return 0;
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  const capped = Math.min(100, percent);
  const raw = (basePaise * capped) / 100;
  return Math.min(basePaise, Math.round(raw));
}

export function fixedDiscountPaise(basePaise: number, amountPaise: number): number {
  if (!Number.isFinite(basePaise) || basePaise <= 0) return 0;
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) return 0;
  return Math.min(basePaise, Math.round(amountPaise));
}

export function lineDiscountPaise(
  basePaise: number,
  offer: OfferForPricing,
): number {
  if (offer.discount_type === "fixed_amount") {
    return fixedDiscountPaise(basePaise, offer.discount_value);
  }
  return percentageDiscountPaise(basePaise, offer.discount_value);
}

/**
 * Authoritative per-line price. `qty` is already clamped by cart/availability.
 * Client-supplied prices are ignored — only the live product + live offer matter.
 */
export function calculateStorePrice(
  product: PriceableProduct,
  qty: number,
  offer: OfferForPricing | null | undefined,
): PricedLine {
  const safeQty = Math.max(0, Math.round(Number(qty) || 0));
  const unit = Math.max(0, Math.round(Number(product.selling_price_paise) || 0));
  const base = unit * safeQty;
  const eligible = safeQty > 0 && productEligibleForOffer(product, offer);
  const discount = eligible && offer ? lineDiscountPaise(base, offer) : 0;
  const finalPaise = Math.max(0, base - discount);
  return {
    product_id: product.id,
    qty: safeQty,
    base_unit_paise: unit,
    base_paise: base,
    discount_paise: discount,
    final_paise: finalPaise,
    unit_final_paise: safeQty > 0 ? Math.round(finalPaise / safeQty) : unit,
    offer_id: discount > 0 && offer ? offer.id : null,
    offer_name: discount > 0 && offer ? offer.name : null,
    offer_slug: discount > 0 && offer ? offer.slug : null,
    discount_type: discount > 0 && offer ? offer.discount_type : null,
    discount_value: discount > 0 && offer ? offer.discount_value : null,
  };
}

export function calculateCartPricing(
  items: Array<{ product: PriceableProduct; qty: number }>,
  offer: OfferForPricing | null | undefined,
): CartPricing {
  const lines = items.map((it) => calculateStorePrice(it.product, it.qty, offer));
  const subtotal = lines.reduce((s, l) => s + l.base_paise, 0);
  const discount = lines.reduce((s, l) => s + l.discount_paise, 0);
  const applied = lines.find((l) => l.offer_id);
  return {
    subtotal_paise: subtotal,
    discount_paise: discount,
    lines,
    offer_id: applied?.offer_id ?? null,
    offer_name: applied?.offer_name ?? null,
    offer_slug: applied?.offer_slug ?? null,
    discount_type: applied?.discount_type ?? null,
    discount_value: applied?.discount_value ?? null,
  };
}

export function offerDiscountLabel(offer: Pick<OfferForPricing, "discount_type" | "discount_value">): string {
  if (offer.discount_type === "fixed_amount") {
    const rupees = Math.round(offer.discount_value) / 100;
    const whole = offer.discount_value % 100 === 0;
    return `₹${rupees.toLocaleString("en-IN", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    })} OFF`;
  }
  return `${Math.round(offer.discount_value)}% OFF`;
}
