/** Customer-facing order projection. Internal states never leave the building. */

export type CustomerStage =
  | "pending"
  | "confirmed"
  | "preparing"
  | "packed"
  | "shipped"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "failed"
  | "delivery_issue"
  | "returning"
  | "return_open"
  | "refund"
  | "refunded";

const STAGE_LABEL: Record<CustomerStage, string> = {
  pending: "Payment received — confirming your order",
  confirmed: "Order Confirmed",
  preparing: "Preparing Your Notes",
  packed: "Packed",
  shipped: "Shipped",
  in_transit: "In Transit",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  failed: "Payment not completed",
  delivery_issue: "Delivery needs another attempt",
  returning: "On the way back to Naman IAS",
  return_open: "Return request received",
  refund: "Refund pending",
  refunded: "Refund recorded",
};

const TRACK_STEPS: CustomerStage[] = ["confirmed", "preparing", "packed", "shipped", "in_transit", "out_for_delivery", "delivered"];

export function projectCustomerStage(internal: string, _hasAwb: boolean): CustomerStage {
  switch (internal) {
    case "PAYMENT_PENDING":
    case "PAYMENT_CONFIRMED":
      return "pending";
    case "PAYMENT_FAILED":
    case "PAYMENT_EXPIRED":
    case "CANCELLED":
    case "CANCEL_REQUESTED":
      return "failed";
    case "ORDER_CONFIRMED":
      return "confirmed";
    case "PROCESSING":
    case "PRINTING":
    case "QUALITY_CHECK":
    case "READY_TO_PACK":
      return "preparing";
    case "PACKED":
    case "READY_FOR_PICKUP":
    case "PICKUP_SCHEDULED":
      return "packed";
    case "PICKED_UP":
      return "shipped";
    case "IN_TRANSIT":
      return "in_transit";
    case "OUT_FOR_DELIVERY":
      return "out_for_delivery";
    case "DELIVERED":
      return "delivered";
    case "DELIVERY_FAILED":
    case "REATTEMPT_REQUESTED":
      return "delivery_issue";
    case "RTO_INITIATED":
    case "RTO_IN_TRANSIT":
    case "RTO_DELIVERED":
      return "returning";
    case "RETURN_REQUESTED":
    case "RETURN_APPROVED":
    case "RETURN_PICKUP_SCHEDULED":
    case "RETURN_IN_TRANSIT":
    case "RETURN_RECEIVED":
      return "return_open";
    case "REFUND_PENDING":
      return "refund";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return "refunded";
    default:
      return "preparing";
  }
}

export function customerStageLabel(stage: CustomerStage): string {
  return STAGE_LABEL[stage];
}

export function trackingSteps(stage: CustomerStage, _hasAwb: boolean) {
  const exceptionUpto: Partial<Record<CustomerStage, CustomerStage>> = {
    delivery_issue: "out_for_delivery",
    returning: "out_for_delivery",
    return_open: "delivered",
    refund: "delivered",
    refunded: "delivered",
  };
  const current = exceptionUpto[stage] || (stage === "pending" || stage === "failed" ? "confirmed" : stage);
  const currentIdx = TRACK_STEPS.indexOf(current);
  return TRACK_STEPS.map((s, i) => ({
    id: s,
    label: STAGE_LABEL[s],
    done: i <= currentIdx,
    skipped: false,
  }));
}
