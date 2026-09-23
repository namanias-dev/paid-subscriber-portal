/**
 * Delhivery read client: PIN serviceability and the invoice charge quote.
 * Shipment creation, waybill allocation, label, and pickup are not called.
 */
import { delhiveryBaseUrl, delhiveryToken } from "./config";
import { rupeesToPaise, type CourierQuote, type ProviderRateResult, type RateRequest } from "./quotes";

type FetchLike = typeof fetch;

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function parseDelhiveryPincode(body: unknown): { prepaid: boolean; cod: boolean; pickup: boolean; city: string | null } | null {
  const root = record(body);
  const list = root?.delivery_codes;
  if (!Array.isArray(list) || !list.length) return null;
  const postal = record(record(list[0])?.postal_code);
  if (!postal) return null;
  const flag = (v: unknown) => str(v).toUpperCase() === "Y";
  return {
    prepaid: flag(postal.pre_paid),
    cod: flag(postal.cod),
    pickup: flag(postal.pickup),
    city: str(postal.city) || null,
  };
}

/** `status` on a charge row echoes the billing mode we asked for. It is not a tracking scan. */
export function parseDelhiveryCharge(body: unknown, service: "Surface" | "Express", codSupported: boolean): CourierQuote | null {
  const row = Array.isArray(body) ? record(body[0]) : record(body);
  if (!row) return null;
  const total = num(row.total_amount);
  if (total == null) return null;
  const zone = str(row.zone);
  return {
    provider: "delhivery",
    courier: "Delhivery",
    service: zone ? `${service} · zone ${zone}` : service,
    ratePaise: rupeesToPaise(total),
    etaDays: null,
    etaText: null,
    codSupported,
    prepaid: true,
  };
}

async function getJson(fetchImpl: FetchLike, url: string, token: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetchImpl(url, {
    headers: { Accept: "application/json", Authorization: `Token ${token}`, "User-Agent": "NamanIAS-NotesStore/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await res.json().catch(() => null)) as unknown;
  return { ok: res.ok, status: res.status, body };
}

export async function quoteDelhivery(
  input: RateRequest,
  opts: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<ProviderRateResult> {
  const env = opts.env || process.env;
  const token = delhiveryToken(env);
  if (!token) {
    return { provider: "delhivery", configured: false, ok: false, quotes: [], error: "Delhivery API token is not set." };
  }
  const fetchImpl = opts.fetchImpl || fetch;
  const base = delhiveryBaseUrl(env);
  try {
    const pin = await getJson(
      fetchImpl,
      `${base}/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(input.deliveryPostcode)}`,
      token,
    );
    if (!pin.ok) {
      return { provider: "delhivery", configured: true, ok: false, quotes: [], error: `Delhivery PIN check failed (${pin.status}).` };
    }
    const service = parseDelhiveryPincode(pin.body);
    if (!service?.prepaid) {
      return { provider: "delhivery", configured: true, ok: true, quotes: [], error: "Delhivery does not show prepaid service for this PIN." };
    }
    const modes = [
      ["S", "Surface"],
      ["E", "Express"],
    ] as const;
    const quotes: CourierQuote[] = [];
    const errors: string[] = [];
    for (const [md, label] of modes) {
      const q = new URLSearchParams({
        md,
        ss: "Delivered",
        d_pin: input.deliveryPostcode,
        o_pin: input.pickupPostcode,
        cgm: String(input.weightGrams),
        pt: "Pre-paid",
        cod: "0",
      });
      const rate = await getJson(fetchImpl, `${base}/api/kinko/v1/invoice/charges/.json?${q}`, token);
      if (!rate.ok) {
        errors.push(`${label} quote failed (${rate.status}).`);
        continue;
      }
      const quote = parseDelhiveryCharge(rate.body, label, service.cod);
      if (quote) quotes.push(quote);
    }
    return {
      provider: "delhivery",
      configured: true,
      ok: quotes.length > 0,
      quotes,
      error: quotes.length ? null : errors[0] || "Delhivery returned no prepaid rate.",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delhivery request failed.";
    return { provider: "delhivery", configured: true, ok: false, quotes: [], error: message.slice(0, 180) };
  }
}
