/**
 * Meta Conversions API (server-side) — completely INERT until env keys are set.
 * Shares `event_id` with the browser Pixel for dedup; Purchase uses a
 * payment_ref-derived event_id and is only ever called once (gated by the
 * idempotent payment_paid write), so cron re-verify never double-fires.
 *
 * Never throws into callers. No PII is logged.
 */
import crypto from "crypto";
import type { Payment } from "../types";

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : undefined;
}

export function metaConfigured(): boolean {
  return !!(env("META_PIXEL_ID") && env("META_CAPI_ACCESS_TOKEN"));
}

function sha256(v: string): string {
  return crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex");
}

/** Deterministic Meta event_id for a payment so Pixel + CAPI + retries dedup. */
export function purchaseEventId(ref: string): string {
  return `paid_${ref}`;
}

async function sendMetaEvent(eventName: string, eventId: string, opts: {
  value?: number;
  currency?: string;
  phone?: string | null;
  email?: string | null;
  customData?: Record<string, unknown>;
}): Promise<void> {
  if (!metaConfigured()) return; // inert until keys provided
  const pixelId = env("META_PIXEL_ID")!;
  const token = env("META_CAPI_ACCESS_TOKEN")!;
  const testCode = env("META_TEST_EVENT_CODE");
  try {
    const user_data: Record<string, unknown> = {};
    if (opts.phone) user_data.ph = [sha256(`91${opts.phone.replace(/\D/g, "").slice(-10)}`)];
    if (opts.email) user_data.em = [sha256(opts.email)];
    const body = {
      data: [{
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        user_data,
        custom_data: { currency: opts.currency || "INR", value: opts.value, ...(opts.customData || {}) },
      }],
      ...(testCode ? { test_event_code: testCode } : {}),
    };
    await fetch(`https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch { /* never throw */ }
}

/** Fire the REAL Meta Purchase. Call ONCE per payment (gated by payment_paid). */
export async function sendMetaPurchase(payment: Payment): Promise<void> {
  const ref = payment.reference_no || payment.id;
  await sendMetaEvent("Purchase", purchaseEventId(ref), {
    value: payment.amount,
    currency: "INR",
    phone: payment.phone,
    email: payment.email,
    customData: { content_type: payment.item_type, content_name: payment.item },
  });
}
