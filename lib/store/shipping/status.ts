/**
 * Courier scans become one shipment status, then one internal order status.
 * A later scan must not walk a delivered order back to in transit.
 */

export const SHIPMENT_STATUSES = [
  "pending",
  "created",
  "manifested",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivery_failed",
  "delivered",
  "rto",
  "cancelled",
  "lost",
  "damaged",
  "failed",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

const SHIPMENT_RANK: Record<string, number> = {
  pending: 10,
  failed: 10,
  created: 20,
  manifested: 30,
  picked_up: 40,
  in_transit: 50,
  delivery_failed: 55,
  out_for_delivery: 60,
  rto: 80,
  delivered: 100,
  cancelled: 100,
  lost: 100,
  damaged: 100,
};

const TERMINAL_SHIPMENT = new Set(["delivered", "cancelled", "lost", "damaged"]);

const ORDER_RANK: Record<string, number> = {
  PAYMENT_PENDING: 0,
  PAYMENT_FAILED: 0,
  PAYMENT_EXPIRED: 0,
  PAYMENT_CONFIRMED: 10,
  ORDER_CONFIRMED: 20,
  PROCESSING: 30,
  PRINTING: 40,
  QUALITY_CHECK: 50,
  READY_TO_PACK: 60,
  PACKED: 70,
  READY_FOR_PICKUP: 80,
  PICKUP_SCHEDULED: 90,
  PICKED_UP: 100,
  IN_TRANSIT: 110,
  DELIVERY_FAILED: 115,
  REATTEMPT_REQUESTED: 116,
  OUT_FOR_DELIVERY: 120,
  RTO_INITIATED: 180,
  RTO_IN_TRANSIT: 190,
  RTO_DELIVERED: 200,
  DELIVERED: 200,
  CANCEL_REQUESTED: 200,
  CANCELLED: 200,
  RETURN_REQUESTED: 200,
  RETURN_APPROVED: 200,
  REFUND_PENDING: 200,
  REFUNDED: 200,
  PARTIALLY_REFUNDED: 200,
};

const TERMINAL_ORDER = new Set([
  "DELIVERED",
  "CANCELLED",
  "RTO_DELIVERED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "PAYMENT_FAILED",
  "PAYMENT_EXPIRED",
]);

export function normalizeCourierStatus(raw: string): ShipmentStatus | null {
  const s = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!s) return null;
  if (s.includes("rto") || s.includes("return to origin")) return "rto";
  if (s.includes("out for delivery") || s === "dispatched") return "out_for_delivery";
  if (s.includes("undelivered") || s.includes("delivery failed") || s.includes("consignee unavailable") || s.includes("ndr")) {
    return "delivery_failed";
  }
  if (s.includes("delivered") && !s.includes("undelivered")) return "delivered";
  if (s.includes("picked up") || s.includes("pickup done") || s === "picked") return "picked_up";
  if (s.includes("in transit") || s.includes("reached") || s.includes("received at")) return "in_transit";
  if (s.includes("manifest") || s.includes("awb assigned") || s.includes("shipment booked")) return "manifested";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("lost")) return "lost";
  if (s.includes("damag")) return "damaged";
  if (s.includes("pending") || s.includes("not picked")) return "pending";
  return null;
}

export function canAdvanceShipment(from: string, to: string): boolean {
  if (from === to) return false;
  if (TERMINAL_SHIPMENT.has(from)) return false;
  if (to === "delivery_failed") {
    return from === "picked_up" || from === "in_transit" || from === "out_for_delivery" || from === "manifested";
  }
  if (to === "rto") return from !== "delivered";
  const a = SHIPMENT_RANK[from] ?? 0;
  const b = SHIPMENT_RANK[to] ?? 0;
  return b > a;
}

export function orderStatusFromShipment(shipmentStatus: string): string | null {
  switch (shipmentStatus) {
    case "picked_up":
      return "PICKED_UP";
    case "in_transit":
      return "IN_TRANSIT";
    case "out_for_delivery":
      return "OUT_FOR_DELIVERY";
    case "delivered":
      return "DELIVERED";
    case "delivery_failed":
      return "DELIVERY_FAILED";
    case "rto":
      return "RTO_IN_TRANSIT";
    default:
      return null;
  }
}

export function canAdvanceOrder(from: string, to: string): boolean {
  if (from === to) return false;
  if (TERMINAL_ORDER.has(from)) return false;
  if (from === "PAYMENT_PENDING") return false;
  if (to === "DELIVERY_FAILED") {
    return ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "PICKUP_SCHEDULED"].includes(from);
  }
  if (to.startsWith("RTO_")) {
    return ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERY_FAILED", "REATTEMPT_REQUESTED"].includes(from);
  }
  const a = ORDER_RANK[from] ?? 0;
  const b = ORDER_RANK[to] ?? 0;
  return b > a;
}
