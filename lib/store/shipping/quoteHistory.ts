/**
 * Courier quote history. An immutable record of each Compare Couriers result and
 * every booking attempt made from it. See docs/notes-store/COURIER_QUOTE_HISTORY.md.
 *
 * - The rates route persists the exact presented list (presentCourierQuotes) before
 *   returning it, and returns the persisted rows. Staff see exactly what is stored.
 * - Booking accepts only quote_session_id + quote_option_id. Provider, courier,
 *   service, courier id and price come from the stored option, never the browser.
 * - A session is bookable only while fresh and only for the package and address it
 *   was quoted for (booking_fingerprint).
 * - Sessions and options are never updated. Attempts record their own outcome.
 * - No street address, phone, email or raw provider payload is stored.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { presentCourierQuotes, type AdminQuote, type PresentedQuote } from "@/lib/store/adminConsole";
import type { ProviderRateResult } from "./quotes";

/**
 * Provider serviceability rates are not reservations, so there is nothing to hold
 * them to. 15 minutes matches the booking lock window used by the dispatch route.
 */
export const QUOTE_TTL_MS = 15 * 60 * 1000;
export { PREMIUM_NOTICE_PAISE } from "@/lib/store/adminConsole";

/** First day comparisons were recorded. Earlier orders have no quote history. */
export const QUOTE_HISTORY_STARTED = "2026-10-04";

export const QUOTE_SAVE_FAILED = "Courier rates were received but could not be saved. Please retry Compare Couriers.";
export const QUOTE_EXPIRED = "Courier rates have expired. Compare Couriers again.";
export const QUOTE_CHANGED = "The package or delivery address changed after these rates were fetched. Compare Couriers again.";
export const QUOTE_REQUIRED = "Compare couriers again and select a rate before booking.";

export type AttemptStatus = "BOOKING" | "BOOKED" | "CITY_CONFIRM" | "FAILED" | "BLOCKED";

export interface QuoteSessionRow {
  id: string;
  order_id: string;
  request_key?: string | null;
  created_at: string;
  created_by_id?: string | null;
  created_by_name?: string | null;
  package_weight_grams: number;
  package_length_mm: number;
  package_width_mm: number;
  package_height_mm: number;
  package_source?: string | null;
  destination_city?: string | null;
  destination_state?: string | null;
  destination_pincode: string;
  booking_fingerprint: string;
  expires_at: string;
  total_quote_count: number;
  eligible_quote_count: number;
  cheapest_eligible_paise: number | null;
  provider_outcomes?: unknown;
}

export interface QuoteOptionRow {
  id: string;
  quote_session_id: string;
  order_id: string;
  position: number;
  provider: string;
  courier_name: string;
  service_name: string | null;
  courier_id: string | null;
  transport_mode: string | null;
  quoted_rate_paise: number;
  eta_days: number | null;
  eta_text: string | null;
  eligible: boolean;
  eligibility_reason: string | null;
  is_cheapest_eligible: boolean;
}

export interface BookingAttemptRow {
  id: string;
  quote_session_id: string;
  quote_option_id: string;
  order_id: string;
  created_at: string;
  selected_by_id?: string | null;
  selected_by_name?: string | null;
  status: AttemptStatus;
  failure_category?: string | null;
  failure_message?: string | null;
  quoted_rate_paise: number;
  cheapest_eligible_paise?: number | null;
  premium_paise?: number | null;
  shipment_id?: string | null;
  awb?: string | null;
  completed_at?: string | null;
}

// ------------------------------------------------------------------ pure

/** Surface / Air / Express from the courier or service name. Unknown stays null. */
export function transportMode(courier: string, service: string | null | undefined): string | null {
  const text = `${courier} ${service || ""}`.toLowerCase();
  if (/\bair\b/.test(text)) return "Air";
  if (/express/.test(text)) return "Express";
  if (/surface|ground/.test(text)) return "Surface";
  return null;
}

/**
 * sha256 over the resolved package and the delivery address fields that change
 * where a parcel goes. Only the hash is stored.
 */
export function bookingFingerprint(pack: { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number }, address: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; pincode?: string | null }): string {
  const norm = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const material = [
    Math.round(pack.weightGrams),
    Math.round(pack.lengthCm * 10),
    Math.round(pack.widthCm * 10),
    Math.round(pack.heightCm * 10),
    norm(address.line1),
    norm(address.line2),
    norm(address.city),
    norm(address.state),
    norm(address.pincode),
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

export function providerOutcomes(providers: ProviderRateResult[]): Array<{ provider: string; configured: boolean; ok: boolean; quotes: number; error: string | null }> {
  return providers.map((p) => ({
    provider: p.provider,
    configured: p.configured,
    ok: p.ok,
    quotes: p.ok ? p.quotes.length : 0,
    // Category only. Raw provider messages can carry request details.
    error: p.ok ? null : !p.configured ? "NOT_CONFIGURED" : /timeout|abort/i.test(p.error || "") ? "TIMEOUT" : "ERROR",
  }));
}

/** The exact rows staff are shown: presentCourierQuotes order, eligibility and cheapest flags. */
export function presentedOptions(providers: ProviderRateResult[]): PresentedQuote[] {
  const flat: AdminQuote[] = providers.flatMap((p) => (p.quotes || []).map((q) => ({
    provider: q.provider,
    courier: q.courier,
    service: q.service,
    ratePaise: q.ratePaise,
    etaText: q.etaText,
    etaDays: q.etaDays,
    courierId: q.courierId ?? null,
    prepaid: q.prepaid,
  })));
  return presentCourierQuotes(flat);
}

export function sessionInsert(input: {
  orderId: string;
  requestKey: string | null;
  actor: { id?: string | null; name?: string | null } | null;
  pack: { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number; source?: string | null };
  destination: { city?: string | null; state?: string | null; pincode: string };
  fingerprint: string;
  presented: PresentedQuote[];
  providers: ProviderRateResult[];
  now: Date;
}) {
  const eligible = input.presented.filter((q) => q.eligible);
  const cheapest = eligible.length ? Math.min(...eligible.map((q) => q.ratePaise)) : null;
  return {
    order_id: input.orderId,
    request_key: input.requestKey,
    created_at: input.now.toISOString(),
    created_by_id: input.actor?.id || null,
    created_by_name: input.actor?.name || input.actor?.id || null,
    package_weight_grams: Math.round(input.pack.weightGrams),
    package_length_mm: Math.round(input.pack.lengthCm * 10),
    package_width_mm: Math.round(input.pack.widthCm * 10),
    package_height_mm: Math.round(input.pack.heightCm * 10),
    package_source: input.pack.source || null,
    destination_city: input.destination.city || null,
    destination_state: input.destination.state || null,
    destination_pincode: input.destination.pincode,
    booking_fingerprint: input.fingerprint,
    expires_at: new Date(input.now.getTime() + QUOTE_TTL_MS).toISOString(),
    currency: "INR",
    total_quote_count: input.presented.length,
    eligible_quote_count: eligible.length,
    cheapest_eligible_paise: cheapest,
    provider_outcomes: providerOutcomes(input.providers),
  };
}

export function optionInserts(sessionId: string, orderId: string, presented: PresentedQuote[]) {
  const eligible = presented.filter((q) => q.eligible);
  const cheapest = eligible.length ? Math.min(...eligible.map((q) => q.ratePaise)) : null;
  return presented.map((q, index) => ({
    quote_session_id: sessionId,
    order_id: orderId,
    position: index + 1,
    provider: q.provider,
    courier_name: q.courier,
    service_name: q.service || null,
    courier_id: q.courierId ? String(q.courierId) : null,
    transport_mode: transportMode(q.courier, q.service),
    quoted_rate_paise: Math.max(0, Math.round(q.ratePaise || 0)),
    eta_days: q.etaDays != null && Number.isFinite(q.etaDays) ? Math.round(q.etaDays) : null,
    eta_text: q.etaText || null,
    eligible: q.eligible,
    eligibility_reason: q.eligible ? null : q.unavailableReason,
    // Ties are all cheapest.
    is_cheapest_eligible: q.eligible && cheapest != null && q.ratePaise === cheapest,
  }));
}

export type SelectionCheck =
  | { ok: true }
  | { ok: false; category: "QUOTE_NOT_FOUND" | "QUOTE_NOT_ELIGIBLE" | "RATE_EXPIRED" | "PACKAGE_OR_ADDRESS_CHANGED"; message: string };

/** Server-side validation of a staff selection against the stored snapshot. */
export function checkSelection(input: {
  orderId: string;
  session: QuoteSessionRow | null;
  option: QuoteOptionRow | null;
  now: Date;
  fingerprint?: string | null;
}): SelectionCheck {
  const { session, option } = input;
  if (!session || !option || session.order_id !== input.orderId || option.quote_session_id !== session.id || option.order_id !== input.orderId) {
    return { ok: false, category: "QUOTE_NOT_FOUND", message: QUOTE_REQUIRED };
  }
  if (!option.eligible || !(option.quoted_rate_paise > 0)) {
    return { ok: false, category: "QUOTE_NOT_ELIGIBLE", message: "This courier option was not eligible. Choose another courier." };
  }
  if (Date.parse(session.expires_at) <= input.now.getTime()) {
    return { ok: false, category: "RATE_EXPIRED", message: QUOTE_EXPIRED };
  }
  if (input.fingerprint !== undefined && input.fingerprint !== session.booking_fingerprint) {
    return { ok: false, category: "PACKAGE_OR_ADDRESS_CHANGED", message: QUOTE_CHANGED };
  }
  return { ok: true };
}

/** Normalised failure category for a booking attempt. */
export function bookingFailureCategory(result: { blocked?: string | null; message?: string | null; creates?: number }): string {
  const message = String(result.message || "").toLowerCase();
  if (result.blocked === "EXISTING_AWB") return "DUPLICATE_SHIPMENT_BLOCK";
  if (message.includes("destination mismatch")) return "ADDRESS_CONFIRMATION_FAILED";
  if (result.blocked === "PICKUP_PENDING") return "PICKUP_PENDING";
  return (result.creates || 0) > 0 ? "PROVIDER_CREATE_FAILED_CANCELLED" : "PROVIDER_CREATE_FAILED";
}

export function premiumPaise(quoted: number, cheapest: number | null | undefined): number | null {
  if (cheapest == null) return null;
  return Math.round(quoted) - Math.round(cheapest);
}

/** "127.5% above cheapest" in tenths of a percent, integer maths. */
export function premiumPercent(quoted: number, cheapest: number | null | undefined): number | null {
  if (!cheapest || cheapest <= 0) return null;
  return Math.round(((quoted - cheapest) * 1000) / cheapest) / 10;
}

export type SessionOutcome = "BOOKED" | "AWAITING_CITY_CONFIRMATION" | "BOOKING" | "FAILED" | "NOT_SELECTED" | "EXPIRED";

export interface SessionView {
  session: QuoteSessionRow;
  number: number;
  options: Array<QuoteOptionRow & { attempts: BookingAttemptRow[] }>;
  attempts: BookingAttemptRow[];
  outcome: SessionOutcome;
  booked: { option: QuoteOptionRow; attempt: BookingAttemptRow } | null;
  cheapest: QuoteOptionRow[];
  premiumPaise: number | null;
  premiumPct: number | null;
}

/** Newest first. Session numbers count from the oldest (#1). */
export function sessionViews(sessions: QuoteSessionRow[], options: QuoteOptionRow[], attempts: BookingAttemptRow[], now: Date): SessionView[] {
  const ordered = [...sessions].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return ordered
    .map((session, index) => {
      const opts = options.filter((o) => o.quote_session_id === session.id).sort((a, b) => a.position - b.position);
      const tried = attempts.filter((a) => a.quote_session_id === session.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
      const bookedAttempt = [...tried].reverse().find((a) => a.status === "BOOKED") || null;
      const bookedOption = bookedAttempt ? opts.find((o) => o.id === bookedAttempt.quote_option_id) || null : null;
      const last = tried[tried.length - 1];
      const outcome: SessionOutcome = bookedAttempt
        ? "BOOKED"
        : last?.status === "CITY_CONFIRM"
          ? "AWAITING_CITY_CONFIRMATION"
          : last?.status === "BOOKING"
            ? "BOOKING"
            : last?.status === "BLOCKED" && last.failure_category === "RATE_EXPIRED"
              ? "EXPIRED"
              : tried.length
                ? "FAILED"
              : Date.parse(session.expires_at) <= now.getTime()
                ? "EXPIRED"
                : "NOT_SELECTED";
      const premium = bookedOption ? premiumPaise(bookedOption.quoted_rate_paise, session.cheapest_eligible_paise) : null;
      return {
        session,
        number: index + 1,
        options: opts.map((o) => ({ ...o, attempts: tried.filter((a) => a.quote_option_id === o.id) })),
        attempts: tried,
        outcome,
        booked: bookedAttempt && bookedOption ? { option: bookedOption, attempt: bookedAttempt } : null,
        cheapest: opts.filter((o) => o.is_cheapest_eligible),
        premiumPaise: premium,
        premiumPct: bookedOption ? premiumPercent(bookedOption.quoted_rate_paise, session.cheapest_eligible_paise) : null,
      };
    })
    .reverse();
}

// -------------------------------------------------------------------- db

export async function findSessionByRequestKey(db: SupabaseClient, orderId: string, requestKey: string | null): Promise<QuoteSessionRow | null> {
  if (!requestKey) return null;
  const { data, error } = await db.from("store_courier_quote_sessions").select("*").eq("request_key", requestKey).maybeSingle();
  if (error || !data || data.order_id !== orderId) return null;
  return data as QuoteSessionRow;
}

export async function loadOptions(db: SupabaseClient, sessionId: string): Promise<QuoteOptionRow[] | null> {
  const { data, error } = await db.from("store_courier_quote_options").select("*").eq("quote_session_id", sessionId).order("position", { ascending: true });
  if (error) return null;
  return (data || []) as QuoteOptionRow[];
}

/**
 * Write the session and its options. Returns null when either write fails; the caller
 * then fails closed (no bookable options). A half-written session has no options and
 * is never bookable.
 */
export async function persistQuoteSession(db: SupabaseClient, session: ReturnType<typeof sessionInsert>, presented: PresentedQuote[]): Promise<{ session: QuoteSessionRow; options: QuoteOptionRow[] } | null> {
  const { data: saved, error } = await db.from("store_courier_quote_sessions").insert(session).select("*").maybeSingle();
  if (error || !saved) {
    if (session.request_key) {
      // A concurrent identical request won the unique key: reuse its session.
      const existing = await findSessionByRequestKey(db, session.order_id, session.request_key);
      if (existing) {
        const options = await loadOptions(db, existing.id);
        return options ? { session: existing, options } : null;
      }
    }
    return null;
  }
  const row = saved as QuoteSessionRow;
  if (!presented.length) return { session: row, options: [] };
  const { data: options, error: optionError } = await db.from("store_courier_quote_options").insert(optionInserts(row.id, row.order_id, presented)).select("*");
  if (optionError || !options || options.length !== presented.length) return null;
  return { session: row, options: (options as QuoteOptionRow[]).sort((a, b) => a.position - b.position) };
}

export async function loadSelection(db: SupabaseClient, sessionId: string, optionId: string): Promise<{ session: QuoteSessionRow | null; option: QuoteOptionRow | null }> {
  const [{ data: session }, { data: option }] = await Promise.all([
    db.from("store_courier_quote_sessions").select("*").eq("id", sessionId).maybeSingle(),
    db.from("store_courier_quote_options").select("*").eq("id", optionId).maybeSingle(),
  ]);
  return { session: (session as QuoteSessionRow) || null, option: (option as QuoteOptionRow) || null };
}

export async function startAttempt(db: SupabaseClient, input: { session: QuoteSessionRow; option: QuoteOptionRow; actor: { id?: string | null; name?: string | null } | null; status?: AttemptStatus; category?: string; message?: string; now?: Date }): Promise<BookingAttemptRow | null> {
  const now = (input.now || new Date()).toISOString();
  const terminal = input.status && input.status !== "BOOKING";
  const { data, error } = await db.from("store_courier_booking_attempts").insert({
    quote_session_id: input.session.id,
    quote_option_id: input.option.id,
    order_id: input.session.order_id,
    created_at: now,
    selected_by_id: input.actor?.id || null,
    selected_by_name: input.actor?.name || input.actor?.id || null,
    status: input.status || "BOOKING",
    failure_category: input.category || null,
    failure_message: input.message ? input.message.slice(0, 200) : null,
    quoted_rate_paise: input.option.quoted_rate_paise,
    cheapest_eligible_paise: input.session.cheapest_eligible_paise,
    premium_paise: premiumPaise(input.option.quoted_rate_paise, input.session.cheapest_eligible_paise),
    completed_at: terminal ? now : null,
  }).select("*").maybeSingle();
  if (error || !data) return null;
  return data as BookingAttemptRow;
}

/** Outcome of an attempt. Never touches the session, its options, or the quoted price. */
export async function finishAttempt(db: SupabaseClient, attemptId: string, patch: { status: AttemptStatus; category?: string | null; message?: string | null; shipmentId?: string | null; awb?: string | null }): Promise<void> {
  await db.from("store_courier_booking_attempts").update({
    status: patch.status,
    failure_category: patch.category ?? null,
    failure_message: patch.message ? patch.message.slice(0, 200) : null,
    shipment_id: patch.shipmentId ?? null,
    awb: patch.awb ?? null,
    completed_at: new Date().toISOString(),
  }).eq("id", attemptId);
}

/** City confirmation resolves the attempt that created the waiting shipment. */
export async function finishCityAttempt(db: SupabaseClient, shipmentId: string, outcome: "BOOKED" | "FAILED"): Promise<void> {
  await db.from("store_courier_booking_attempts").update({
    status: outcome,
    failure_category: outcome === "FAILED" ? "CITY_CONFIRMATION_DECLINED" : null,
    completed_at: new Date().toISOString(),
  }).eq("shipment_id", shipmentId).eq("status", "CITY_CONFIRM");
}

export async function loadHistory(db: SupabaseClient, orderId: string): Promise<{ sessions: QuoteSessionRow[]; options: QuoteOptionRow[]; attempts: BookingAttemptRow[] } | null> {
  const [sessions, options, attempts] = await Promise.all([
    db.from("store_courier_quote_sessions").select("*").eq("order_id", orderId).order("created_at", { ascending: false }).limit(50),
    db.from("store_courier_quote_options").select("*").eq("order_id", orderId).limit(2000),
    db.from("store_courier_booking_attempts").select("*").eq("order_id", orderId).order("created_at", { ascending: true }).limit(500),
  ]);
  if (sessions.error || options.error || attempts.error) return null;
  return {
    sessions: (sessions.data || []) as QuoteSessionRow[],
    options: (options.data || []) as QuoteOptionRow[],
    attempts: (attempts.data || []) as BookingAttemptRow[],
  };
}

export interface QuoteHistorySummary {
  sessions: number;
  lastOptionCount: number;
  bookedPaise: number | null;
  cheapestPaise: number | null;
  premiumPaise: number | null;
}

/** Orders list: counts and the latest booked comparison only. Two batched reads, no options. */
export async function historySummaries(db: SupabaseClient, orderIds: string[]): Promise<Map<string, QuoteHistorySummary>> {
  const out = new Map<string, QuoteHistorySummary & { lastAt?: string }>();
  const ids = [...new Set(orderIds.filter(Boolean))];
  for (let index = 0; index < ids.length; index += 200) {
    const slice = ids.slice(index, index + 200);
    const [sessions, attempts] = await Promise.all([
      db.from("store_courier_quote_sessions").select("order_id,created_at,total_quote_count").in("order_id", slice),
      db.from("store_courier_booking_attempts").select("order_id,created_at,status,quoted_rate_paise,cheapest_eligible_paise,premium_paise").in("order_id", slice).eq("status", "BOOKED"),
    ]);
    if (sessions.error || attempts.error) return out;
    for (const row of (sessions.data || []) as Array<{ order_id: string; created_at: string; total_quote_count: number }>) {
      const cur = out.get(row.order_id) || { sessions: 0, lastOptionCount: 0, bookedPaise: null, cheapestPaise: null, premiumPaise: null, lastAt: "" };
      cur.sessions += 1;
      if (row.created_at > (cur.lastAt || "")) {
        cur.lastAt = row.created_at;
        cur.lastOptionCount = Number(row.total_quote_count) || 0;
      }
      out.set(row.order_id, cur);
    }
    const latest = new Map<string, { created_at: string; quoted_rate_paise: number; cheapest_eligible_paise: number | null; premium_paise: number | null }>();
    for (const row of (attempts.data || []) as Array<{ order_id: string; created_at: string; quoted_rate_paise: number; cheapest_eligible_paise: number | null; premium_paise: number | null }>) {
      const cur = latest.get(row.order_id);
      if (!cur || row.created_at > cur.created_at) latest.set(row.order_id, row);
    }
    for (const [orderId, row] of latest) {
      const cur = out.get(orderId);
      if (!cur) continue;
      cur.bookedPaise = row.quoted_rate_paise;
      cur.cheapestPaise = row.cheapest_eligible_paise;
      cur.premiumPaise = row.premium_paise;
    }
  }
  for (const value of out.values()) delete value.lastAt;
  return out;
}
