/**
 * Shipment booking decisions. A paid order is never booked unless billable
 * writes are explicitly authorized. Recording a packed size does not book one.
 */
import { shippingWritesAuthorized } from "./config";

const ACTIVE = new Set(["pending", "created", "manifested", "picked_up", "in_transit", "out_for_delivery", "delivered", "rto"]);

export function shipmentAlreadyActive(status: string | null | undefined, awb: string | null | undefined): boolean {
  if (!awb) return false;
  return ACTIVE.has(status || "");
}

export function dispatchBlocked(env: NodeJS.ProcessEnv = process.env): string | null {
  if (shippingWritesAuthorized(env)) return null;
  return "Shipment creation is switched off. No label, AWB, or pickup is sent to a courier. Enter the AWB manually after the parcel is handed over.";
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
        payment_mode: "Prepaid",
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

export function refundRequestPaise(totalPaise: number, alreadyPaise: number, askedPaise: number): { amount: number } | { error: string } {
  if (!Number.isInteger(askedPaise) || askedPaise <= 0) return { error: "Enter a refund amount." };
  const room = Math.max(0, totalPaise - alreadyPaise);
  if (askedPaise > room) return { error: "Refund is larger than the amount still available." };
  return { amount: askedPaise };
}
