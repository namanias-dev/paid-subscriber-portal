/**
 * PIN → serviceability and a concrete promised delivery date.
 *
 * Phase 1 has no courier API, so the date is computed from our own zone table
 * plus the product's dispatch_days plus a two-day buffer. That buffer is the
 * under-promise: a missed date in launch week is a trust event.
 *
 * City/state are filled from our cache when we have them, otherwise from the
 * India Post public lookup, cached for 90 days. A downed lookup never blocks
 * checkout — the zone answer is enough to promise a date.
 */
import { storeDb } from "./db";

export const PHASE1_DELIVERY_BUFFER_DAYS = 2;

export interface StoreZone {
  pincode_prefix: string;
  zone: string;
  label: string | null;
  transit_days_min: number;
  transit_days_max: number;
  shipping_paise: number;
  free_above_paise: number | null;
  serviceable: boolean;
}

export interface PinCheckResult {
  pincode: string;
  serviceable: boolean;
  city: string | null;
  state: string | null;
  zone: StoreZone;
  /** Inclusive calendar date the customer is promised, YYYY-MM-DD (IST). */
  promised_date: string;
  promised_label: string;
  dispatch_days: number;
  transit_days: number;
  buffer_days: number;
}

function istYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

function addCalendarDaysIst(from: Date, days: number): Date {
  // Work in IST calendar dates, not UTC milliseconds, so a late-evening
  // checkout in India is not promised a day earlier than the customer thinks.
  const [y, m, day] = istYmd(from).split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, day + days));
  return utc;
}

function formatIstLong(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function computePromisedDate(dispatchDays: number, transitMax: number, from = new Date()): string {
  const total = Math.max(0, dispatchDays) + Math.max(0, transitMax) + PHASE1_DELIVERY_BUFFER_DAYS;
  return istYmd(addCalendarDaysIst(from, total));
}

export function isValidPincode(raw: string): boolean {
  return /^[1-9][0-9]{5}$/.test((raw || "").trim());
}

async function loadZones(): Promise<StoreZone[]> {
  const db = storeDb();
  if (!db) return [];
  const { data } = await db
    .from("store_zones")
    .select("pincode_prefix,zone,label,transit_days_min,transit_days_max,shipping_paise,free_above_paise,serviceable")
    .order("pincode_prefix", { ascending: false });
  return (data || []) as StoreZone[];
}

export function matchZone(pincode: string, zones: StoreZone[]): StoreZone {
  const pin = pincode.trim();
  const sorted = [...zones].sort((a, b) => b.pincode_prefix.length - a.pincode_prefix.length);
  for (const z of sorted) {
    if (z.pincode_prefix && pin.startsWith(z.pincode_prefix)) return z;
  }
  return (
    sorted.find((z) => z.pincode_prefix === "") || {
      pincode_prefix: "",
      zone: "national",
      label: "Rest of India",
      transit_days_min: 5,
      transit_days_max: 9,
      shipping_paise: 9900,
      free_above_paise: null,
      serviceable: true,
    }
  );
}

async function lookupCityState(pincode: string): Promise<{ city: string | null; state: string | null; source: string }> {
  const db = storeDb();
  if (db) {
    const { data } = await db
      .from("store_pincode_cache")
      .select("city,state,expires_at")
      .eq("pincode", pincode)
      .maybeSingle();
    if (data && new Date(data.expires_at).getTime() > Date.now()) {
      return { city: data.city, state: data.state, source: "cache" };
    }
  }

  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    const json = (await res.json()) as Array<{ Status?: string; PostOffice?: Array<{ District?: string; State?: string; Name?: string }> }>;
    const po = json?.[0]?.PostOffice?.[0];
    if (json?.[0]?.Status === "Success" && po) {
      const city = po.District || po.Name || null;
      const state = po.State || null;
      if (db) {
        await db.from("store_pincode_cache").upsert({
          pincode,
          city,
          state,
          serviceable: true,
          source: "postalpincode.in",
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
        });
      }
      return { city, state, source: "postalpincode.in" };
    }
  } catch {
    /* lookup is best-effort */
  }
  return { city: null, state: null, source: "none" };
}

export async function checkPincode(pincode: string, dispatchDays = 2): Promise<PinCheckResult | { error: string }> {
  const pin = (pincode || "").trim();
  if (!isValidPincode(pin)) return { error: "Enter a 6-digit PIN code" };
  const zones = await loadZones();
  const zone = matchZone(pin, zones);
  const { city, state } = await lookupCityState(pin);
  const promised = computePromisedDate(dispatchDays, zone.transit_days_max);
  return {
    pincode: pin,
    serviceable: zone.serviceable,
    city,
    state,
    zone,
    promised_date: promised,
    promised_label: formatIstLong(promised),
    dispatch_days: dispatchDays,
    transit_days: zone.transit_days_max,
    buffer_days: PHASE1_DELIVERY_BUFFER_DAYS,
  };
}
