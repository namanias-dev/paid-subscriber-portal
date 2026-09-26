/**
 * Store money helpers. Paise integers everywhere; rupees exist only for display
 * and for the gateway. No floats in any stored value, no currency library.
 */

/** ₹1,299 — no decimals when the amount is whole rupees, which it usually is. */
export function formatPaise(paise: number): string {
  const p = Math.round(paise || 0);
  const rupees = p / 100;
  const whole = p % 100 === 0;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Discount percentage off MRP, rounded down so we never overstate a saving. */
export function discountPercent(mrpPaise: number, sellingPaise: number): number {
  if (!mrpPaise || mrpPaise <= sellingPaise) return 0;
  return Math.floor(((mrpPaise - sellingPaise) / mrpPaise) * 100);
}

/**
 * What the storefront shows. An active offer discount stays the payable price.
 * With no offer, MRP above the selling price is the struck list price — the
 * selling price itself is what checkout charges.
 */
export function presentStorePrice(input: {
  mrpPaise: number;
  finalPaise: number;
  offerDiscountPaise?: number;
  offerBasePaise?: number;
  offerBadge?: string | null;
}): {
  payablePaise: number;
  comparePaise: number | null;
  savePaise: number;
  percentOff: number;
  badge: string | null;
} {
  const payablePaise = Math.max(0, Math.round(Number(input.finalPaise) || 0));
  const offerDiscountPaise = Math.max(0, Math.round(Number(input.offerDiscountPaise) || 0));
  if (offerDiscountPaise > 0) {
    return {
      payablePaise,
      comparePaise: Math.max(0, Math.round(Number(input.offerBasePaise) || 0)) || null,
      savePaise: offerDiscountPaise,
      percentOff: 0,
      badge: input.offerBadge || null,
    };
  }
  const mrpPaise = Math.max(0, Math.round(Number(input.mrpPaise) || 0));
  const percentOff = discountPercent(mrpPaise, payablePaise);
  if (percentOff > 0) {
    return {
      payablePaise,
      comparePaise: mrpPaise,
      savePaise: mrpPaise - payablePaise,
      percentOff,
      badge: `${percentOff}% OFF`,
    };
  }
  return { payablePaise, comparePaise: null, savePaise: 0, percentOff: 0, badge: null };
}

/**
 * Tax on a line, from the product's own snapshot. Never a hard-coded rate: the
 * CA's position on HSN 4901 vs 4820 decides the treatment, and it is data.
 */
export function lineTaxPaise(taxableBasePaise: number, treatment: string, rateBps: number): number {
  if (treatment !== "taxable" || !rateBps) return 0;
  return Math.round((taxableBasePaise * rateBps) / 10_000);
}
