/**
 * Catalogue money rules. Paise integers only. The CHECK constraint
 * `selling_price_paise <= mrp_paise` is what used to reject a ₹1 SKU when MRP
 * was left at the form default of 0.
 */

/** Active catalogue items cannot be cheaper than ₹1. */
export const MIN_ACTIVE_SELLING_PAISE = 100;

export function normalizeStoreProductPrices(input: {
  mrp_paise: unknown;
  selling_price_paise: unknown;
}): { mrp_paise: number; selling_price_paise: number } {
  const selling = Math.round(Number(input.selling_price_paise));
  const mrpIn = Math.round(Number(input.mrp_paise));
  if (!Number.isFinite(selling) || selling < 1) {
    throw new Error("Selling price must be at least 1 paise (₹1 = 100)");
  }
  if (!Number.isFinite(mrpIn) || mrpIn < 0) {
    throw new Error("MRP must be a whole number of paise");
  }
  return { mrp_paise: Math.max(mrpIn, selling), selling_price_paise: selling };
}

export function assertActiveSellingPrice(sellingPaise: number, isActive: boolean): void {
  if (isActive && sellingPaise < MIN_ACTIVE_SELLING_PAISE) {
    throw new Error("A live SKU must be at least ₹1 (100 paise)");
  }
}
