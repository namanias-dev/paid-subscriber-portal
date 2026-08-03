/**
 * GA4 Measurement Protocol helpers (server-only).
 * Fire-and-forget; never throws into callers. Idempotent purchase via DB claim.
 */
import { getSupabaseAdmin } from "../supabase";
import type { Payment } from "../types";

function measurementId(): string {
  return (process.env.GA4_MEASUREMENT_ID || process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "").trim();
}

function apiSecret(): string {
  return (process.env.GA4_API_SECRET || "").trim();
}

export function productTypeFromPayment(p: Payment): "webinar" | "seat_booking" | "installment" | "full_payment" {
  if (p.item_type === "webinar") return "webinar";
  if (p.payment_kind === "seat") return "seat_booking";
  if (p.payment_kind === "installment") return "installment";
  return "full_payment";
}

/**
 * Send payment_success via MP exactly once per order.
 * Claims ga_purchase_sent_at first so ladder/retries cannot double-send.
 */
export async function sendGa4PaymentSuccess(p: Payment): Promise<void> {
  try {
    const mid = measurementId();
    const secret = apiSecret();
    if (!mid || !secret) return;

    const ref = (p.reference_no || p.id || "").trim();
    if (!ref || !p.id) return;

    const db = getSupabaseAdmin();
    if (!db) return;

    const now = new Date().toISOString();
    const { data: claimed } = await db
      .from("payments")
      .update({ ga_purchase_sent_at: now })
      .eq("id", p.id)
      .is("ga_purchase_sent_at", null)
      .select("id, ga_client_id")
      .maybeSingle();

    if (!claimed) return; // already sent or race lost

    const clientId =
      (typeof (claimed as { ga_client_id?: string | null }).ga_client_id === "string" &&
        (claimed as { ga_client_id?: string }).ga_client_id?.trim()) ||
      (p.ga_client_id || "").trim() ||
      // GA4 requires a client_id; synthetic is better than dropping the hit entirely.
      `server.${p.id.replace(/-/g, "").slice(0, 16)}`;

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(mid)}&api_secret=${encodeURIComponent(secret)}`;
    const body = {
      client_id: clientId,
      events: [
        {
          name: "payment_success",
          params: {
            value: Number(p.amount) || 0,
            currency: "INR",
            transaction_id: ref,
            product_type: productTypeFromPayment(p),
            engagement_time_msec: 1,
          },
        },
      ],
    };

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Do not hang the payment path.
      signal: AbortSignal.timeout(2500),
    }).catch(() => {});
  } catch {
    /* never throw into PAID transition */
  }
}

/** Validate a payload against GA4 debug MP (no persistence). */
export async function debugGa4MpPayload(payload: unknown): Promise<{ ok: boolean; validationMessages: unknown[] }> {
  try {
    const mid = measurementId();
    const secret = apiSecret();
    if (!mid || !secret) return { ok: false, validationMessages: [{ description: "missing GA4_MEASUREMENT_ID or GA4_API_SECRET" }] };
    const url = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(mid)}&api_secret=${encodeURIComponent(secret)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as {
      validationMessages?: unknown[];
    };
    const msgs = Array.isArray(json.validationMessages) ? json.validationMessages : [];
    return { ok: msgs.length === 0, validationMessages: msgs };
  } catch (e) {
    return { ok: false, validationMessages: [{ description: (e as Error).message }] };
  }
}
