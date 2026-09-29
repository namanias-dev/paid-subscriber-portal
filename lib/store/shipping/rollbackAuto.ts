/**
 * One-order rollback of an auto-booked pickup that the courier has not scanned.
 * Possession, an unreadable tracking read, or an unconfirmed cancel stops the rollback.
 */
import { normalizeCourierStatus } from "./status";

export const ROLLBACK_ORDER_NO = "NIAS-N-2026-001030";
export const ROLLBACK_AWB = "90680216572";

const POSSESSED = new Set([
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "rto",
  "delivery_failed",
  "lost",
  "damaged",
]);

export interface RollbackInput {
  orderNo: string;
  orderStatus: string;
  awb: string | null;
  shipStatus: string | null;
  pickedUpAt: string | null;
  trackingStatus: string | null;
  trackingError: string | null;
  activities: string[];
}

export type RollbackDecision =
  | { action: "cancel" }
  | { action: "block"; reason: "ORDER_NOT_IN_SCOPE" | "AWB_MISMATCH" | "POSSESSION" | "STATUS" | "TRACKING_UNCONFIRMED" };

export function rollbackDecision(input: RollbackInput): RollbackDecision {
  if (input.orderNo !== ROLLBACK_ORDER_NO) return { action: "block", reason: "ORDER_NOT_IN_SCOPE" };
  if (input.awb !== ROLLBACK_AWB) return { action: "block", reason: "AWB_MISMATCH" };
  if (input.pickedUpAt) return { action: "block", reason: "POSSESSION" };
  if (input.orderStatus !== "PICKUP_SCHEDULED") return { action: "block", reason: "STATUS" };
  if (input.shipStatus === "picked_up" || input.shipStatus === "in_transit" || input.shipStatus === "out_for_delivery" || input.shipStatus === "delivered") {
    return { action: "block", reason: "POSSESSION" };
  }
  if (input.trackingError || !input.trackingStatus) return { action: "block", reason: "TRACKING_UNCONFIRMED" };
  const seen = [input.trackingStatus, ...input.activities]
    .map((value) => normalizeCourierStatus(value))
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  if (seen.some((status) => POSSESSED.has(status))) return { action: "block", reason: "POSSESSION" };
  const current = normalizeCourierStatus(input.trackingStatus);
  if (current !== "manifested" && current !== "pending") return { action: "block", reason: "TRACKING_UNCONFIRMED" };
  return { action: "cancel" };
}

export function cancellationConfirmed(status: string | null | undefined): boolean {
  if (!status) return false;
  return normalizeCourierStatus(status) === "cancelled";
}
