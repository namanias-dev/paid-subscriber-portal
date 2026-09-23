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
  | "failed";

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
    default:
      return "preparing";
  }
}

export function customerStageLabel(stage: CustomerStage): string {
  return STAGE_LABEL[stage];
}

export function trackingSteps(stage: CustomerStage, _hasAwb: boolean) {
  const current = stage === "pending" || stage === "failed" ? "confirmed" : stage;
  const currentIdx = TRACK_STEPS.indexOf(current);
  return TRACK_STEPS.map((s, i) => ({
    id: s,
    label: STAGE_LABEL[s],
    done: i <= currentIdx,
    skipped: false,
  }));
}
