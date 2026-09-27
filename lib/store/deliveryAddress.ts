/**
 * Delivery-address confirmation. Pure and client-safe.
 * Google Maps is a search URL the person opens themselves. It is not a verification API.
 */

export type AddressConfirmationStatus =
  | "UNCONFIRMED"
  | "CUSTOMER_CONFIRMED"
  | "ADMIN_CONFIRMED"
  | "ADMIN_UPDATED_CUSTOMER_CONFIRMED";

export interface DeliveryFields {
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface AddressChangeDecision {
  action: "update" | "rebook" | "locked" | "request_only" | "immutable" | "busy" | "rejected";
  code: string;
  message: string;
}

const POSSESSED = new Set([
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "delivery_failed",
  "rto",
  "lost",
  "damaged",
]);

const ORDER_POSSESSED = new Set([
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "DELIVERY_FAILED",
  "RTO_INITIATED",
  "RTO_IN_TRANSIT",
  "RTO_DELIVERED",
]);

export function collapseSpace(value: string | null | undefined): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function compareKey(value: string | null | undefined): string {
  return collapseSpace(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** House number, PIN, city, and state stay. Only spacing is collapsed for the courier string. */
export function canonicalDelivery(input: DeliveryFields): DeliveryFields {
  return {
    line1: collapseSpace(input.line1),
    line2: collapseSpace(input.line2) || null,
    landmark: collapseSpace(input.landmark) || null,
    city: collapseSpace(input.city),
    state: collapseSpace(input.state),
    pincode: collapseSpace(input.pincode),
  };
}

export function addressFingerprint(input: DeliveryFields): string {
  const key = [input.line1, input.line2, input.city, input.state, input.pincode].map(compareKey).join("|");
  let hash = 5381;
  for (let i = 0; i < key.length; i += 1) hash = ((hash * 33) ^ key.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export function formatDeliveryAddress(input: DeliveryFields & { name?: string | null }): string {
  const canonical = canonicalDelivery(input);
  const place = [canonical.city, canonical.state].filter(Boolean).join(", ");
  return [input.name, canonical.line1, canonical.line2, canonical.landmark, place ? `${place} ${canonical.pincode}` : canonical.pincode, "India"]
    .map((part) => collapseSpace(part))
    .filter(Boolean)
    .join("\n");
}

/** Standard Maps search URL. No API key and no Maps Platform billing. */
export function googleMapsSearchUrl(formatted: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatted)}`;
}

export function confirmationMatches(input: DeliveryFields, hash: string | null | undefined): boolean {
  return Boolean(hash) && hash === addressFingerprint(input);
}

export function materialAddressChange(current: DeliveryFields, next: DeliveryFields): boolean {
  return compareKey(current.pincode) !== compareKey(next.pincode)
    || compareKey(current.city) !== compareKey(next.city)
    || compareKey(current.state) !== compareKey(next.state);
}

export function decideAddressChange(input: {
  orderStatus: string;
  lockFresh: boolean;
  shipmentStatus: string | null;
  awb: string | null;
  possessed: boolean;
}): AddressChangeDecision {
  const status = input.orderStatus;
  if (status === "DELIVERED" || input.shipmentStatus === "delivered") {
    return { action: "immutable", code: "DELIVERED", message: "This delivered address stays as the shipment record." };
  }
  if (status === "CANCELLED" || status.startsWith("REFUND")) {
    return { action: "rejected", code: "CANCELLED", message: "Cancelled orders do not need a delivery-address change." };
  }
  if (input.lockFresh) {
    return { action: "busy", code: "FULFILLMENT_RUNNING", message: "Fulfillment is running. Wait for it to finish before changing the address." };
  }
  if (input.possessed || POSSESSED.has(input.shipmentStatus || "") || ORDER_POSSESSED.has(status)) {
    return {
      action: "request_only",
      code: "CARRIER_POSSESSION",
      message: "The courier has already taken possession of this parcel. Changing the order address here would not change the courier destination.",
    };
  }
  if (input.awb && input.shipmentStatus && input.shipmentStatus !== "cancelled" && input.shipmentStatus !== "failed") {
    return {
      action: "rebook",
      code: "ACTIVE_AWB",
      message: "The existing shipment must be cancelled and replaced before this address can become the delivery destination.",
    };
  }
  return { action: "update", code: "NO_SHIPMENT", message: "The next shipment will use this address." };
}

export function addressAnalyticsProps(input: { reason?: string; itemCount?: number }): Record<string, unknown> {
  return {
    schema_version: 1,
    reason: input.reason || null,
    item_count: input.itemCount ?? null,
  };
}

export function activeCustomerShipment<T extends { awb: string | null; status: string }>(rows: T[]): T | null {
  return rows.find((row) => row.awb && row.status !== "cancelled" && row.status !== "failed") || null;
}

export function oneActiveAwb(rows: Array<{ awb: string | null; status: string }>): boolean {
  const active = rows.filter((row) => row.awb && row.status !== "cancelled" && row.status !== "failed");
  return active.length <= 1;
}
