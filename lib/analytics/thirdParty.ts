/**
 * Meta Conversions API (server-side) — completely INERT until env keys are set.
 *
 * Shares a DETERMINISTIC `event_id` with the browser Pixel so Meta dedupes the
 * pixel + CAPI copies into a single conversion. Purchase uses a payment_ref
 * event_id and is only ever called once (gated by the idempotent payment_paid
 * write), so cron re-verify never double-fires.
 *
 * MATCHING (privacy-first):
 *  - By default we send ONLY non-PII match keys: `fbc`/`fbp` (the Meta click
 *    cookies) + the shared `event_id`. Attribution works fully in this mode.
 *  - HASHED PII (phone/email → SHA-256) is built here but is GATED behind the
 *    G1 flag `META_ADVANCED_MATCHING=1`. Until that flag is on, NO PII (not even
 *    hashed) is ever sent to Meta. See `advancedMatchingEnabled()`.
 *
 * Never throws into callers. No raw PII is ever logged.
 */
import crypto from "crypto";
import type { Payment } from "../types";
import { getSupabaseAdmin } from "../supabase";
import { SITE_URL } from "../config";
import {
  META_GRAPH_VERSION,
  purchaseEventId,
  leadEventId,
  initiateCheckoutEventId,
  type MetaEventName,
} from "./metaEvents";

export { purchaseEventId, leadEventId, initiateCheckoutEventId };

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : undefined;
}

/** Dataset (pixel) id — server env wins, else fall back to the public pixel id. */
function datasetId(): string | undefined {
  return env("META_PIXEL_ID") || env("NEXT_PUBLIC_META_PIXEL_ID");
}

/** CAPI is live only when BOTH the dataset id and the access token are present. */
export function metaConfigured(): boolean {
  return !!(datasetId() && env("META_CAPI_ACCESS_TOKEN"));
}

/**
 * HARD GATE G1. Advanced matching (sending hashed PII to Meta) is OFF unless the
 * operator explicitly sets META_ADVANCED_MATCHING=1 AFTER confirming it's allowed
 * under the data policy. Everything else (fbc/fbp/event_id matching) works
 * regardless of this flag.
 */
export function advancedMatchingEnabled(): boolean {
  return env("META_ADVANCED_MATCHING") === "1";
}

function graphVersion(): string {
  return env("META_GRAPH_VERSION") || META_GRAPH_VERSION;
}

function sha256(v: string): string {
  return crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex");
}

/** E.164-normalized phone → SHA-256 (India +91). Only used when G1 is enabled. */
function hashedPhone(phone: string | null | undefined): string | null {
  const d = (phone || "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? sha256(`91${d}`) : null;
}

/**
 * Persist ONE CAPI delivery outcome (status, events_received, fbtrace_id, error)
 * to `meta_capi_log`. FAILURE-SAFE by contract: every path is swallowed so a
 * logging error can NEVER break the user flow or the calling emitter. No PII and
 * no access token are ever written (only Meta's own response fields).
 */
async function logCapiDelivery(entry: {
  event_name: string;
  event_id: string;
  ok: boolean;
  http_status: number | null;
  events_received: number | null;
  fbtrace_id: string | null;
  test_mode: boolean;
  error: unknown;
}): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    if (!db) return;
    await db.from("meta_capi_log").insert({
      event_name: entry.event_name,
      event_id: entry.event_id,
      ok: entry.ok,
      http_status: entry.http_status,
      events_received: entry.events_received,
      fbtrace_id: entry.fbtrace_id,
      test_mode: entry.test_mode,
      error: entry.error ?? null,
    });
  } catch {
    /* never throw — logging is strictly best-effort */
  }
}

/** Canonical event_source_url for a payment's item (SITE_URL-based, no PII). */
function eventSourceUrlForPayment(p: Payment): string {
  if (p.item_type === "course" && p.item_slug) return `${SITE_URL}/courses/${p.item_slug}`;
  if (p.item_type === "webinar" && p.item_slug) return `${SITE_URL}/webinars/${p.item_slug}`;
  return SITE_URL;
}

export interface MetaEventInput {
  value?: number;
  currency?: string;
  /** Raw PII — ONLY hashed & sent when G1 (advanced matching) is enabled. */
  phone?: string | null;
  email?: string | null;
  /** Non-PII Meta match keys (always sent when present). */
  fbc?: string | null;
  fbp?: string | null;
  eventSourceUrl?: string | null;
  customData?: Record<string, unknown>;
}

/**
 * Low-level CAPI sender. Builds `user_data` privacy-first:
 *  - always: fbc/fbp when available (non-PII);
 *  - hashed ph/em ONLY when advancedMatchingEnabled() (G1).
 * Returns silently (never throws) and no-ops when not configured.
 */
async function sendMetaEvent(eventName: MetaEventName, eventId: string, opts: MetaEventInput): Promise<void> {
  if (!metaConfigured()) return; // inert until keys provided
  const pixelId = datasetId()!;
  const token = env("META_CAPI_ACCESS_TOKEN")!;
  const testCode = env("META_TEST_EVENT_CODE");
  try {
    const user_data: Record<string, unknown> = {};
    if (opts.fbc) user_data.fbc = opts.fbc;
    if (opts.fbp) user_data.fbp = opts.fbp;
    // G1: hashed PII is included ONLY when advanced matching is explicitly enabled.
    if (advancedMatchingEnabled()) {
      const ph = hashedPhone(opts.phone);
      if (ph) user_data.ph = [ph];
      if (opts.email) user_data.em = [sha256(opts.email)];
    }
    const custom_data: Record<string, unknown> = { currency: opts.currency || "INR", ...(opts.customData || {}) };
    if (typeof opts.value === "number") custom_data.value = opts.value;
    const body = {
      data: [{
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        ...(opts.eventSourceUrl ? { event_source_url: opts.eventSourceUrl } : {}),
        user_data,
        custom_data,
      }],
      ...(testCode ? { test_event_code: testCode } : {}),
    };
    // Capture the Graph API response so delivery is provable (2xx + events_received)
    // or the error is surfaced — without ever blocking or breaking the user flow.
    let httpStatus: number | null = null;
    let eventsReceived: number | null = null;
    let fbtraceId: string | null = null;
    let errObj: unknown = null;
    let ok = false;
    try {
      const res = await fetch(`https://graph.facebook.com/${graphVersion()}/${pixelId}/events?access_token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      httpStatus = res.status;
      const json = (await res.json().catch(() => null)) as
        | { events_received?: number; fbtrace_id?: string; error?: unknown }
        | null;
      if (json) {
        if (typeof json.events_received === "number") eventsReceived = json.events_received;
        if (typeof json.fbtrace_id === "string") fbtraceId = json.fbtrace_id;
        if (json.error) errObj = json.error;
      }
      ok = res.ok && !errObj;
    } catch (e) {
      errObj = { message: (e as Error)?.message || "fetch_failed" };
    }
    void logCapiDelivery({
      event_name: eventName,
      event_id: eventId,
      ok,
      http_status: httpStatus,
      events_received: eventsReceived,
      fbtrace_id: fbtraceId,
      test_mode: !!testCode,
      error: errObj,
    });
  } catch { /* never throw */ }
}

/**
 * Fire the REAL Meta Purchase. Call ONCE per payment (gated by payment_paid) with
 * the SAME reconciled rupee amount that marked it PAID — never recomputed here.
 * The pixel fires the same event_id on the success page → Meta counts one.
 */
export async function sendMetaPurchase(
  payment: Payment,
  match?: { fbc?: string | null; fbp?: string | null },
): Promise<void> {
  const ref = payment.reference_no || payment.id;
  await sendMetaEvent("Purchase", purchaseEventId(ref), {
    value: payment.amount,
    currency: "INR",
    phone: payment.phone,
    email: payment.email,
    fbc: match?.fbc ?? null,
    fbp: match?.fbp ?? null,
    eventSourceUrl: eventSourceUrlForPayment(payment),
    customData: {
      content_type: "product",
      content_category: payment.item_type, // "course" | "webinar"
      content_name: payment.item,
      content_ids: [payment.item_slug || payment.item_type],
    },
  });
}

/** Fire Lead for a (free) registration — same event_id as the browser pixel. */
export async function sendMetaLead(input: {
  id: string;
  phone?: string | null;
  value?: number;
  contentName?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  eventSourceUrl?: string | null;
}): Promise<void> {
  await sendMetaEvent("Lead", leadEventId(input.id), {
    value: input.value ?? 0,
    currency: "INR",
    phone: input.phone,
    fbc: input.fbc ?? null,
    fbp: input.fbp ?? null,
    eventSourceUrl: input.eventSourceUrl ?? null,
    customData: input.contentName ? { content_name: input.contentName } : {},
  });
}

/** Fire InitiateCheckout when a payment attempt (PENDING row) is created. */
export async function sendMetaInitiateCheckout(
  payment: Payment,
  match?: { fbc?: string | null; fbp?: string | null },
): Promise<void> {
  const ref = payment.reference_no || payment.id;
  await sendMetaEvent("InitiateCheckout", initiateCheckoutEventId(ref), {
    value: payment.amount,
    currency: "INR",
    phone: payment.phone,
    email: payment.email,
    fbc: match?.fbc ?? null,
    fbp: match?.fbp ?? null,
    eventSourceUrl: eventSourceUrlForPayment(payment),
    customData: {
      content_category: payment.item_type,
      content_name: payment.item,
      content_ids: [payment.item_slug || payment.item_type],
    },
  });
}
