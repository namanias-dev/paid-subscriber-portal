/**
 * Shipment booking decisions. A paid order is never booked unless billable
 * writes are explicitly authorized. Recording a packed size does not book one.
 */
import { shippingWritesAuthorized } from "./config";
import { classifyTrackingGap } from "./reconcile";

const ACTIVE = new Set(["pending", "created", "manifested", "picked_up", "in_transit", "out_for_delivery", "delivered", "rto"]);

export function shipmentAlreadyActive(status: string | null | undefined, awb: string | null | undefined): boolean {
  if (!awb) return false;
  return ACTIVE.has(status || "");
}

export function dispatchBlocked(env: NodeJS.ProcessEnv = process.env): string | null {
  if (shippingWritesAuthorized(env)) return null;
  return "Live shipping is not enabled yet. No label, AWB, or pickup is sent to a courier. Enter the AWB manually after the parcel is handed over.";
}

export interface DelhiveryShipmentDraft {
  pickupName: string;
  orderNo: string;
  name: string;
  address: string;
  pin: string;
  city: string;
  state: string;
  phone: string;
  product: string;
  amountRupees: number;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** Prepaid is a forward shipment. Pickup is a Delhivery reverse pickup. */
  paymentMode?: "Prepaid" | "Pickup";
}

/**
 * Delhivery CMU body. Not sent by any route.
 * `pickup_location.name` must match the Facility Name in Delhivery One exactly.
 */
export function delhiveryCreateBody(draft: DelhiveryShipmentDraft): string {
  const pickupName = draft.pickupName.trim();
  if (!pickupName) throw new Error("Delhivery pickup location name is not set.");
  const payload = {
    pickup_location: { name: pickupName },
    shipments: [
      {
        name: draft.name,
        add: draft.address,
        pin: draft.pin,
        city: draft.city,
        state: draft.state,
        country: "India",
        phone: draft.phone,
        order: draft.orderNo,
        payment_mode: draft.paymentMode === "Pickup" ? "Pickup" : "Prepaid",
        products_desc: draft.product,
        cod_amount: "0",
        total_amount: String(draft.amountRupees),
        weight: String(draft.weightGrams),
        quantity: "1",
        shipment_length: String(draft.lengthCm),
        shipment_width: String(draft.widthCm),
        shipment_height: String(draft.heightCm),
      },
    ],
  };
  return `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
}

export const SUPPORT_REASONS = [
  "damaged",
  "wrong_subject",
  "missing_item",
  "incomplete_pages",
  "print_defect",
  "delivery_problem",
] as const;

export function supportReasonAllowed(reason: string): boolean {
  return (SUPPORT_REASONS as readonly string[]).includes(reason);
}

export function canRequestSupport(status: string): boolean {
  return status === "DELIVERED" || status === "DELIVERY_FAILED";
}

/** Reasons an order needs a person. A generated AWB or label is not one of them. */
export function fulfilmentAttention(input: {
  orderStatus: string;
  awb?: string | null;
  hasLabel?: boolean;
}): string[] {
  const reasons: string[] = [];
  const status = input.orderStatus;
  if (status === "DELIVERY_FAILED") reasons.push("delivery_failed");
  if (status === "RTO_INITIATED" || status === "RTO_IN_TRANSIT" || status === "RTO_DELIVERED") reasons.push("rto");
  if (status.startsWith("RETURN_")) reasons.push("return");
  if (status === "REFUND_PENDING") reasons.push("refund_pending");
  if ((status === "PACKED" || status === "READY_FOR_PICKUP") && !input.awb) reasons.push("awb_missing");
  if (input.awb && input.hasLabel === false && (status === "READY_FOR_PICKUP" || status === "PICKUP_SCHEDULED")) {
    reasons.push("label_missing");
  }
  return reasons;
}

export const OPERATIONAL_ACTIONS = [
  "awb_missing",
  "shipment_failed",
  "pickup_overdue",
  "tracking_stale",
  "delivery_delayed",
  "delivery_failed",
  "ndr",
  "rto",
  "return_waiting",
  "refund_manual",
] as const;

export type OperationalAction = (typeof OPERATIONAL_ACTIONS)[number];

/** One order's open work. Counts are for the overview; nothing here calls a courier. */
export function operationalActions(input: {
  orderStatus: string;
  now: string;
  awb?: string | null;
  provider?: string | null;
  shipmentStatus?: string | null;
  shipmentCreatedAt?: string | null;
  pickupScheduledAt?: string | null;
  pickedUpAt?: string | null;
  lastSyncedAt?: string | null;
  expectedDeliveryDate?: string | null;
  promisedDeliveryDate?: string | null;
}): OperationalAction[] {
  const reasons = new Set<OperationalAction>();
  const status = input.orderStatus;
  if ((status === "PACKED" || status === "READY_FOR_PICKUP") && !input.awb) reasons.add("awb_missing");
  if (input.shipmentStatus === "failed") reasons.add("shipment_failed");
  if (status === "DELIVERY_FAILED") reasons.add("delivery_failed");
  if (input.shipmentStatus === "delivery_failed" || status === "REATTEMPT_REQUESTED") reasons.add("ndr");
  if (status.startsWith("RTO_") || input.shipmentStatus === "rto") reasons.add("rto");
  if (status === "RETURN_REQUESTED") reasons.add("return_waiting");
  if (status === "REFUND_PENDING") reasons.add("refund_manual");

  const gap = classifyTrackingGap({
    status: input.shipmentStatus || "pending",
    provider: input.provider || "manual",
    awb: input.awb || null,
    createdAt: input.shipmentCreatedAt || input.now,
    now: input.now,
    pickupScheduledAt: input.pickupScheduledAt,
    pickedUpAt: input.pickedUpAt,
    lastSyncedAt: input.lastSyncedAt,
    expectedDeliveryDate: input.expectedDeliveryDate || input.promisedDeliveryDate,
  });
  if (gap.includes("pickup_overdue")) reasons.add("pickup_overdue");
  if (gap.includes("stale") || gap.includes("webhook_gap")) reasons.add("tracking_stale");
  if (gap.includes("eta_exceeded")) reasons.add("delivery_delayed");
  if (input.promisedDeliveryDate && input.promisedDeliveryDate.slice(0, 10) < input.now.slice(0, 10)) {
    if (["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"].includes(status)) reasons.add("delivery_delayed");
  }
  return OPERATIONAL_ACTIONS.filter((key) => reasons.has(key));
}

export function refundRequestPaise(totalPaise: number, alreadyPaise: number, askedPaise: number): { amount: number } | { error: string } {
  if (!Number.isInteger(askedPaise) || askedPaise <= 0) return { error: "Enter a refund amount." };
  const room = Math.max(0, totalPaise - alreadyPaise);
  if (askedPaise > room) return { error: "Refund is larger than the amount still available." };
  return { amount: askedPaise };
}
