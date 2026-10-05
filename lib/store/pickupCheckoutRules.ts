/**
 * Academy Pickup checkout request rules. Pure: no database, no network.
 *
 * The request is authoritative and explicit. It names its method, carries the
 * location code and fingerprint the customer acknowledged, and the server checks both
 * against its own record. Delivery fields (address lines, landmark, instructions,
 * address hash) are ignored for pickup, so hidden delivery inputs can never block or
 * shape a pickup order.
 */
import type { ActivePickupLocation } from "./pickupLocation";

export interface PickupCheckoutBody {
  fulfillment_method?: unknown;
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  pincode?: unknown;
  pickup_location_code?: unknown;
  pickup_location_fingerprint?: unknown;
  pickup_acknowledged?: unknown;
}

export type PickupErrorCode =
  | "PICKUP_UNAVAILABLE"
  | "LOCATION_CHANGED"
  | "NOT_ACKNOWLEDGED"
  | "INVALID_NAME"
  | "INVALID_PHONE"
  | "INVALID_EMAIL"
  | "INVALID_PIN"
  | "PIN_LOOKUP_UNAVAILABLE"
  | "TAX_UNSUPPORTED"
  | "ALREADY_PLACING";

export class PickupCheckoutError extends Error {
  constructor(
    message: string,
    readonly code: PickupErrorCode,
    readonly status: number = 400,
    readonly field: string | null = null,
  ) {
    super(message);
  }
}

export interface PickupContact {
  name: string;
  phone: string;
  rawPhone: string;
  email: string | undefined;
  pincode: string;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

export const PICKUP_COPY = {
  unavailable: "Academy Pickup isn't available right now. Please choose Delivery.",
  locationChanged: "The pickup location details were updated. Please review them and confirm again.",
  notAcknowledged: "Confirm that you'll collect from Chandigarh before paying.",
  taxUnsupported: "Academy Pickup isn't available for one of these items yet. Please choose Delivery.",
  alreadyPlacing: "This order is already being placed. Check your order page, or refresh to start again.",
} as const;

export function validatePickupCheckout(body: PickupCheckoutBody, active: ActivePickupLocation): PickupContact {
  if (!active.ok) throw new PickupCheckoutError(PICKUP_COPY.unavailable, "PICKUP_UNAVAILABLE", 409);
  if (text(body.pickup_location_code) !== active.location.code || text(body.pickup_location_fingerprint) !== active.fingerprint) {
    throw new PickupCheckoutError(PICKUP_COPY.locationChanged, "LOCATION_CHANGED", 409);
  }
  if (body.pickup_acknowledged !== true) {
    throw new PickupCheckoutError(PICKUP_COPY.notAcknowledged, "NOT_ACKNOWLEDGED", 400, "pickup_acknowledged");
  }
  const name = text(body.name).trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) throw new PickupCheckoutError("Enter your full name", "INVALID_NAME", 400, "name");
  const rawPhone = text(body.phone).trim();
  const phone = rawPhone.replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) throw new PickupCheckoutError("Enter a 10-digit mobile number", "INVALID_PHONE", 400, "phone");
  const email = text(body.email).trim();
  if (email && (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new PickupCheckoutError("Enter a valid email, or leave it blank", "INVALID_EMAIL", 400, "email");
  }
  const pincode = text(body.pincode).trim();
  if (!/^[1-9][0-9]{5}$/.test(pincode)) throw new PickupCheckoutError("Enter a 6-digit PIN code", "INVALID_PIN", 400, "pincode");
  return { name, phone, rawPhone, email: email || undefined, pincode };
}
