/**
 * Shiprocket read client. Login and serviceability only.
 * Creating an order, AWB, label, or pickup is intentionally not called.
 */
import { shiprocketBaseUrl, shiprocketCredentials } from "./config";
import { rupeesToPaise, type CourierQuote, type ProviderRateResult, type RateRequest } from "./quotes";

type FetchLike = typeof fetch;

interface TokenCache {
  token: string;
  /** Epoch ms. Shiprocket documents a 10-day JWT; we refresh a day early. */
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

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

export function parseShiprocketQuotes(body: unknown): CourierQuote[] {
  const root = record(body);
  const data = record(root?.data) || root;
  const list = data?.available_courier_companies;
  if (!Array.isArray(list)) return [];
  const quotes: CourierQuote[] = [];
  for (const row of list) {
    const c = record(row);
    if (!c) continue;
    const courier = str(c.courier_name);
    const rate = num(c.rate) ?? num(c.freight_charge);
    if (!courier || rate == null) continue;
    const etaDaysRaw = num(c.estimated_delivery_days);
    const etaText = str(c.etd) || (etaDaysRaw != null ? `${etaDaysRaw} days` : null);
    const surface = c.is_surface === true || num(c.is_surface) === 1;
    quotes.push({
      provider: "shiprocket",
      courier,
      service: surface ? "Surface" : str(c.mode) || "Courier",
      ratePaise: rupeesToPaise(rate),
      etaDays: etaDaysRaw != null ? Math.round(etaDaysRaw) : null,
      etaText,
      codSupported: num(c.cod) === 1 || c.cod === true,
      prepaid: true,
      courierId: str(c.courier_company_id) || (num(c.courier_company_id) != null ? String(num(c.courier_company_id)) : null),
    });
  }
  return quotes;
}

export async function shiprocketToken(opts: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv; now?: number } = {}): Promise<string> {
  const env = opts.env || process.env;
  const creds = shiprocketCredentials(env);
  if (!creds) throw new Error("Shiprocket API user is not configured.");
  const now = opts.now ?? Date.now();
  if (tokenCache && tokenCache.expiresAt > now && !opts.env && !opts.fetchImpl) return tokenCache.token;
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(`${shiprocketBaseUrl(env)}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await res.json().catch(() => null)) as unknown;
  const rec = record(body);
  const token = str(rec?.token);
  if (!res.ok || !token) {
    const message = str(rec?.message) || `Shiprocket login failed (${res.status}).`;
    throw new Error(message.slice(0, 180));
  }
  if (!opts.env && !opts.fetchImpl) {
    tokenCache = { token, expiresAt: now + 9 * 24 * 60 * 60 * 1000 };
  }
  return token;
}

export function resetShiprocketTokenCache(): void {
  tokenCache = null;
}

/**
 * Adhoc order body. The pickup field is the nickname (`work`), never the
 * numeric pickup id. This object is not posted.
 */
export function shiprocketAdhocDraft(input: {
  pickupLocation: string;
  orderNumber: string;
  name: string;
  address: string;
  pin: string;
  city: string;
  state: string;
  phone: string;
  product: string;
  amountRupees: number;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}): Record<string, unknown> {
  const pickup = input.pickupLocation.trim();
  if (!pickup || /^\d+$/.test(pickup)) {
    throw new Error("Shiprocket pickup_location must be the pickup nickname, not the numeric address id.");
  }
  const parts = input.name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || "Customer";
  const last = parts.slice(1).join(" ") || ".";
  return {
    order_id: input.orderNumber,
    order_date: "",
    pickup_location: pickup,
    billing_customer_name: first,
    billing_last_name: last,
    billing_address: input.address,
    billing_city: input.city,
    billing_pincode: input.pin,
    billing_state: input.state,
    billing_country: "India",
    billing_phone: input.phone,
    shipping_is_billing: true,
    order_items: [{ name: input.product, sku: input.orderNumber, units: 1, selling_price: input.amountRupees }],
    payment_method: "Prepaid",
    sub_total: input.amountRupees,
    length: input.lengthCm,
    breadth: input.widthCm,
    height: input.heightCm,
    weight: input.weightKg,
  };
}

/** Tracking read. Does not assign an AWB or buy a label. */
export async function trackShiprocketAwb(
  awb: string,
  opts: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<{ rawStatus: string | null; recognized: boolean; courier: string | null; error: string | null; eventTime: string | null; location: string | null; activity: string | null }> {
  const code = awb.trim();
  if (!code) return { rawStatus: null, recognized: false, courier: null, error: null, eventTime: null, location: null, activity: null };
  const env = opts.env || process.env;
  if (!shiprocketCredentials(env)) return { rawStatus: null, recognized: false, courier: null, error: null, eventTime: null, location: null, activity: null };
  try {
    const token = await shiprocketToken(opts);
    const fetchImpl = opts.fetchImpl || fetch;
    const res = await fetchImpl(`${shiprocketBaseUrl(env)}/courier/track/awb/${encodeURIComponent(code)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    const body = record(await res.json().catch(() => null));
    const tracking = record(body?.tracking_data);
    const tracks = Array.isArray(tracking?.shipment_track) ? tracking.shipment_track.map(record).filter(Boolean) : [];
    const first = tracks[0] || null;
    const rawStatus =
      str(first?.current_status) ||
      str(tracking?.current_status) ||
      (typeof tracking?.shipment_status === "string" ? str(tracking.shipment_status) : "") ||
      str(body?.current_status) ||
      null;
    const error = str(tracking?.error) || (!res.ok ? `Shiprocket tracking was not read (${res.status}).` : "");
    const activities = Array.isArray(tracking?.shipment_track_activities) ? tracking.shipment_track_activities.map(record).filter(Boolean) : [];
    const latest = activities
      .map((row) => ({
        activity: str(row?.activity) || str(row?.["sr-status-label"]) || str(row?.status),
        time: str(row?.date) || str(row?.["sr-status"]) || "",
        location: str(row?.location),
      }))
      .filter((row) => row.activity || row.time)
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
    return {
      rawStatus: rawStatus || null,
      recognized: Boolean(first?.awb_code || first?.current_status) && !error,
      courier: str(first?.courier_name) || null,
      error: error || null,
      eventTime: latest?.time || str(first?.updated_time_stamp) || str(first?.pickup_date) || null,
      location: latest?.location || null,
      activity: latest?.activity || rawStatus || null,
    };
  } catch {
    return { rawStatus: null, recognized: false, courier: null, error: "Shiprocket tracking was not read.", eventTime: null, location: null, activity: null };
  }
}

export async function quoteShiprocket(
  input: RateRequest,
  opts: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<ProviderRateResult> {
  const env = opts.env || process.env;
  if (!shiprocketCredentials(env)) {
    return { provider: "shiprocket", configured: false, ok: false, quotes: [], error: "Shiprocket API user is not set." };
  }
  try {
    const token = await shiprocketToken(opts);
    const fetchImpl = opts.fetchImpl || fetch;
    const q = new URLSearchParams({
      pickup_postcode: input.pickupPostcode,
      delivery_postcode: input.deliveryPostcode,
      cod: "0",
      weight: String(input.weightGrams / 1000),
      length: String(input.lengthCm),
      breadth: String(input.widthCm),
      height: String(input.heightCm),
    });
    const res = await fetchImpl(`${shiprocketBaseUrl(env)}/courier/serviceability/?${q}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const message = str(record(body)?.message) || `Shiprocket serviceability failed (${res.status}).`;
      return { provider: "shiprocket", configured: true, ok: false, quotes: [], error: message.slice(0, 180) };
    }
    const quotes = parseShiprocketQuotes(body);
    return {
      provider: "shiprocket",
      configured: true,
      ok: true,
      quotes,
      error: quotes.length ? null : "No Shiprocket courier is serviceable for this PIN and weight.",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Shiprocket request failed.";
    return { provider: "shiprocket", configured: true, ok: false, quotes: [], error: message.slice(0, 180) };
  }
}
