/**
 * Notes Store customer notifications — integration boundary (spec §11).
 *
 * Proactive updates are SMS via the Academy's existing DLT sender. Two hard gates
 * keep this safe and inert until the business is ready:
 *
 *   1. Feature flag `notes_store_sms` must be ON (off in production and preview).
 *   2. An approved DLT template id must be configured per message type.
 *
 * The Notes DLT templates are drafted (docs/notes-store-dlt-templates.md) but NOT
 * yet submitted/approved, so no template ids exist and nothing is sent. When the
 * templates are approved and the ids + flag are set, the real send is wired at the
 * single marked point below — no other code changes. This never throws into the
 * caller (payment capture / ship must not depend on SMS) and never logs PII.
 */
import { storeFeatureEnabled } from "./flags";

export type StoreNotificationType = "order_confirmed" | "order_shipped";

export interface StoreNotificationResult {
  sent: boolean;
  reason: "flag_off" | "no_template" | "sent" | "error";
}

/** Env var NAMES only for the approved DLT template ids (never values). */
const TEMPLATE_ENV: Record<StoreNotificationType, string> = {
  order_confirmed: "NOTES_STORE_SMS_TEMPLATE_ORDER_CONFIRMED",
  order_shipped: "NOTES_STORE_SMS_TEMPLATE_ORDER_SHIPPED",
};

async function dispatch(type: StoreNotificationType): Promise<StoreNotificationResult> {
  try {
    if (!(await storeFeatureEnabled("notes_store_sms"))) return { sent: false, reason: "flag_off" };
    const templateId = (process.env[TEMPLATE_ENV[type]] || "").trim();
    if (!templateId) return { sent: false, reason: "no_template" };

    // ── DLT SEND WIRING POINT ────────────────────────────────────────────────
    // When approved template ids exist, load the order's phone + variables here
    // and call the Academy sender (lib/sms/service `sendSms`) with `templateId`.
    // Until then this path is unreachable (no template id is configured), so no
    // customer message is ever sent. Kept as an explicit boundary, not a stub
    // that pretends to send.
    // ─────────────────────────────────────────────────────────────────────────
    return { sent: false, reason: "no_template" };
  } catch {
    return { sent: false, reason: "error" };
  }
}

/** Order paid + confirmed. Safe no-op until DLT approved and flag on. */
export async function notifyOrderConfirmed(_input: { orderId: string; orderNo: string | null }): Promise<StoreNotificationResult> {
  return dispatch("order_confirmed");
}

/** Order shipped with AWB. Safe no-op until DLT approved and flag on. */
export async function notifyOrderShipped(_input: {
  orderId: string;
  orderNo: string | null;
  awb: string;
  courier: string;
}): Promise<StoreNotificationResult> {
  return dispatch("order_shipped");
}
