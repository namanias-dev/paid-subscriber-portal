import { pickupPostcode, shippingWritesAuthorized } from "./config";
import { quoteDelhivery } from "./delhiveryApi";
import { assertRateRequest, lowestQuote, type ProviderRateResult, type RateRequest } from "./quotes";
import { quoteShiprocket } from "./shiprocketApi";

export interface CompareRatesInput {
  deliveryPostcode: string;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  declaredValuePaise: number;
}

export interface CompareRatesResult {
  ok: boolean;
  error: string | null;
  pickupPostcode: string | null;
  writesAuthorized: boolean;
  providers: ProviderRateResult[];
  lowest: ReturnType<typeof lowestQuote>;
}

/**
 * Live quotes from whichever provider is configured. A failed provider does
 * not drop the other. This never creates a shipment.
 */
export async function compareCourierRates(
  input: CompareRatesInput,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<CompareRatesResult> {
  const env = opts.env || process.env;
  const origin = pickupPostcode(env);
  const writesAuthorized = shippingWritesAuthorized(env);
  if (!origin) {
    return {
      ok: false,
      error: "Set NOTES_STORE_PICKUP_POSTCODE to the Chandigarh pickup PIN before quoting.",
      pickupPostcode: null,
      writesAuthorized,
      providers: [],
      lowest: null,
    };
  }
  const request: RateRequest = {
    pickupPostcode: origin,
    deliveryPostcode: input.deliveryPostcode.trim(),
    weightGrams: input.weightGrams,
    lengthCm: input.lengthCm,
    widthCm: input.widthCm,
    heightCm: input.heightCm,
    declaredValuePaise: input.declaredValuePaise,
  };
  const invalid = assertRateRequest(request);
  if (invalid) {
    return { ok: false, error: invalid, pickupPostcode: origin, writesAuthorized, providers: [], lowest: null };
  }
  const providers = await Promise.all([quoteDelhivery(request, opts), quoteShiprocket(request, opts)]);
  const any = providers.some((p) => p.ok && p.quotes.length);
  return {
    ok: any,
    error: any ? null : "No courier quote is available for this PIN.",
    pickupPostcode: origin,
    writesAuthorized,
    providers,
    lowest: lowestQuote(providers),
  };
}
