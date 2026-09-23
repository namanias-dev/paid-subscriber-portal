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

/** Delhivery CMU body. Not sent unless dispatchBlocked() is null. */
export function delhiveryCreateBody(draft: DelhiveryShipmentDraft): string {
  const payload = {
    pickup_location: { name: draft.pickupName },
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

export function refundRequestPaise(totalPaise: number, alreadyPaise: number, askedPaise: number): { amount: number } | { error: string } {
  if (!Number.isInteger(askedPaise) || askedPaise <= 0) return { error: "Enter a refund amount." };
  const room = Math.max(0, totalPaise - alreadyPaise);
  if (askedPaise > room) return { error: "Refund is larger than the amount still available." };
  return { amount: askedPaise };
}
