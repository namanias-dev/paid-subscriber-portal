/** Normalized courier quotes. Rates come from provider responses, never from samples. */

export type ShippingProviderName = "shiprocket" | "delhivery";

export interface CourierQuote {
  provider: ShippingProviderName;
  courier: string;
  service: string;
  /** Integer paise. */
  ratePaise: number;
  etaDays: number | null;
  etaText: string | null;
  codSupported: boolean;
  prepaid: boolean;
}

export interface ProviderRateResult {
  provider: ShippingProviderName;
  configured: boolean;
  ok: boolean;
  quotes: CourierQuote[];
  error: string | null;
}

export interface RateRequest {
  pickupPostcode: string;
  deliveryPostcode: string;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** Declared value in paise. Prepaid notes orders are not COD. */
  declaredValuePaise: number;
}

export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees) || rupees < 0) return 0;
  return Math.round(rupees * 100);
}

export function assertRateRequest(input: RateRequest): string | null {
  if (!/^[1-9][0-9]{5}$/.test(input.pickupPostcode)) return "Pickup PIN is not configured.";
  if (!/^[1-9][0-9]{5}$/.test(input.deliveryPostcode)) return "Delivery PIN is invalid.";
  if (!Number.isInteger(input.weightGrams) || input.weightGrams < 50 || input.weightGrams > 30000) {
    return "Weight must be between 50 g and 30 kg.";
  }
  for (const [label, n] of [
    ["Length", input.lengthCm],
    ["Width", input.widthCm],
    ["Height", input.heightCm],
  ] as const) {
    if (!Number.isFinite(n) || n < 0.5 || n > 200) return `${label} must be between 0.5 cm and 200 cm.`;
  }
  return null;
}

export function lowestQuote(results: ProviderRateResult[]): CourierQuote | null {
  const quotes = results.flatMap((r) => (r.ok ? r.quotes : []));
  if (!quotes.length) return null;
  return quotes.reduce((best, q) => (q.ratePaise < best.ratePaise ? q : best));
}
