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
 * Tax on a line, from the product's own snapshot. Never a hard-coded rate: the
 * CA's position on HSN 4901 vs 4820 decides the treatment, and it is data.
 */
export function lineTaxPaise(taxableBasePaise: number, treatment: string, rateBps: number): number {
  if (treatment !== "taxable" || !rateBps) return 0;
  return Math.round((taxableBasePaise * rateBps) / 10_000);
}
