/** Customer-facing order projection. Internal states never leave the building. */

export type CustomerStage = "pending" | "confirmed" | "preparing" | "shipped" | "out_for_delivery" | "delivered" | "failed";

const STAGE_LABEL: Record<CustomerStage, string> = {
  pending: "Payment received — confirming your order",
  confirmed: "Order Confirmed",
  preparing: "Preparing Your Notes",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  failed: "Payment not completed",
};

const TRACK_STEPS: CustomerStage[] = ["confirmed", "preparing", "shipped", "out_for_delivery", "delivered"];

export function projectCustomerStage(internal: string, hasAwb: boolean): CustomerStage {
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
    case "DELIVERED":
      return "delivered";
    case "OUT_FOR_DELIVERY":
      return "out_for_delivery";
    case "IN_TRANSIT":
    case "PICKED_UP":
      return hasAwb ? "shipped" : "preparing";
    default:
      return hasAwb ? "shipped" : "preparing";
  }
}

export function customerStageLabel(stage: CustomerStage): string {
  return STAGE_LABEL[stage];
}

export function trackingSteps(stage: CustomerStage, hasAwb: boolean) {
  return TRACK_STEPS.map((s) => ({
    id: s,
    label: STAGE_LABEL[s],
    done: TRACK_STEPS.indexOf(s) <= TRACK_STEPS.indexOf(stage === "pending" ? "confirmed" : stage === "failed" ? "confirmed" : stage),
    skipped: s === "shipped" && !hasAwb && stage !== "shipped" && stage !== "out_for_delivery" && stage !== "delivered",
  }));
}
