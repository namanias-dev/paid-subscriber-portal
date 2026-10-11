/**
 * Notes Store customer notifications — integration boundary (spec §11).
 *
 * Proactive updates are SMS via the Academy's existing DLT sender. Gates:
 *
 *   1. Feature flag `notes_store_sms` must be ON (store kill switch).
 *   2. An approved DLT template must exist for the message type.
 *
 * Order confirmed uses the approved NOTES_ORDER_CONFIRMED_01 template through
 * lib/store/sms (Mission Control automation `notes_order_confirmed`). Shipped,
 * ready-for-collection and collected have no approved template yet, so nothing
 * is sent for them. This never throws into the caller (payment capture / ship
 * must not depend on SMS) and never logs PII.
 */
import { waitUntil } from "@vercel/functions";
import { storeFeatureEnabled } from "./flags";

export type StoreNotificationType = "order_confirmed" | "order_shipped" | "order_ready_for_collection" | "order_collected";

export interface StoreNotificationResult {
  sent: boolean;
  reason: "flag_off" | "no_template" | "scheduled" | "sent" | "error";
}

async function noApprovedTemplate(): Promise<StoreNotificationResult> {
  try {
    if (!(await storeFeatureEnabled("notes_store_sms"))) return { sent: false, reason: "flag_off" };
    return { sent: false, reason: "no_template" };
  } catch {
    return { sent: false, reason: "error" };
  }
}

/**
 * Order paid + confirmed. Hands the SMS to waitUntil so the payment response is
 * not held; the automation itself checks the flag, rule, cutover and order.
 */
export async function notifyOrderConfirmed(input: { orderId: string; orderNo: string | null }): Promise<StoreNotificationResult> {
  try {
    const work = import("./sms/automation")
      .then((m) => m.fireNotesOrderConfirmedSms(input.orderId))
      .catch(() => {
        console.error("[store/notifications] order_confirmed_sms_failed");
      });
    try {
      waitUntil(work);
    } catch {
      void work;
    }
    return { sent: false, reason: "scheduled" };
  } catch {
    return { sent: false, reason: "error" };
  }
}

/** Order shipped with AWB. No approved template yet. */
export async function notifyOrderShipped(_input: {
  orderId: string;
  orderNo: string | null;
  awb: string;
  courier: string;
}): Promise<StoreNotificationResult> {
  return noApprovedTemplate();
}

/** Academy Pickup order is ready at the academy. No approved template yet. */
export async function notifyReadyForCollection(_input: { orderId: string; orderNo: string | null }): Promise<StoreNotificationResult> {
  return noApprovedTemplate();
}

/** Academy Pickup order handed over. No approved template yet. */
export async function notifyCollected(_input: { orderId: string; orderNo: string | null }): Promise<StoreNotificationResult> {
  return noApprovedTemplate();
}
