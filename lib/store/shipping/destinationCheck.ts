/**
 * Courier read-back versus the customer's destination.
 * PIN and state stay strict. A city passes only when it is the same place,
 * the PIN's stored city, or an alias already tied to that exact PIN.
 * A blank Delhivery telephone is not a destination failure.
 */
import { normalizePlace } from "../address";

export type DestinationVerdict = "pass" | "confirm" | "fail";
export type DestinationReason = "match" | "canonical" | "alias" | "expansion" | "pin" | "state" | "city" | "unread";

export interface DestinationPlace {
  city: string;
  state: string;
  pincode: string;
}

/**
 * District names a provider has already returned for this exact PIN.
 * Not a global city list. 110085's cache city is North Delhi; Shiprocket
 * has stored North West Delhi for that same PIN and state.
 */
export const PIN_CITY_ALIASES: Record<string, readonly string[]> = {
  "110085": ["North West Delhi"],
};

export function aliasesForPin(pincode: string): string[] {
  return [...(PIN_CITY_ALIASES[pincode.trim()] || [])];
}

/** Last 10 digits. Empty when the customer phone is not a 10-digit number. */
export function normalizedCustomerPhone(phone: string | null | undefined): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  const ten = digits.length >= 10 ? digits.slice(-10) : digits;
  return ten.length === 10 ? ten : null;
}

export function canonicalCityForPin(
  row: { pincode?: string | null; city?: string | null; state?: string | null } | null | undefined,
  order: { pincode: string; state: string },
): string | null {
  const city = String(row?.city || "").trim();
  if (!city) return null;
  const rowPin = String(row?.pincode || order.pincode).trim();
  if (rowPin !== order.pincode.trim()) return null;
  const rowState = String(row?.state || "").trim();
  if (!rowState || normalizePlace(rowState) !== normalizePlace(order.state)) return null;
  return city;
}

function containsPlace(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function classifyCourierDestination(input: {
  order: DestinationPlace;
  provider: { city?: string | null; state?: string | null; pincode?: string | null };
  canonicalCity?: string | null;
  aliases?: string[];
}): { verdict: DestinationVerdict; reason: DestinationReason } {
  const orderPin = input.order.pincode.trim();
  const providerPin = String(input.provider.pincode || "").trim();
  if (!providerPin || providerPin !== orderPin) return { verdict: "fail", reason: "pin" };

  const orderState = normalizePlace(input.order.state);
  const providerState = normalizePlace(String(input.provider.state || ""));
  if (!orderState || !providerState || providerState !== orderState) return { verdict: "fail", reason: "state" };

  const orderCity = normalizePlace(input.order.city);
  const providerCity = normalizePlace(String(input.provider.city || ""));
  if (!orderCity || !providerCity) return { verdict: "fail", reason: "unread" };
  if (orderCity === providerCity) return { verdict: "pass", reason: "match" };

  const canonical = normalizePlace(String(input.canonicalCity || ""));
  if (canonical && providerCity === canonical) return { verdict: "pass", reason: "canonical" };

  const aliasHit = (input.aliases || []).some((alias) => normalizePlace(alias) === providerCity);
  if (aliasHit) return { verdict: "pass", reason: "alias" };

  const sharesCanonical = Boolean(
    canonical &&
      containsPlace(orderCity, canonical) &&
      containsPlace(providerCity, canonical) &&
      containsPlace(orderCity, providerCity),
  );
  if (sharesCanonical) return { verdict: "pass", reason: "expansion" };

  if (containsPlace(orderCity, providerCity)) return { verdict: "confirm", reason: "city" };
  return { verdict: "fail", reason: "city" };
}

/**
 * Read-back decision. Delhivery may omit the telephone after a valid send.
 * Shiprocket still has to echo a phone. An unread destination fails closed.
 */
export function evaluateProviderReadback(input: {
  provider: "shiprocket" | "delhivery";
  order: DestinationPlace;
  stored: { pin: string | null; city: string | null; state: string | null; phoneStored: boolean; read: boolean };
  sentPhone: string | null | undefined;
  canonicalCity?: string | null;
  aliases?: string[];
}): { addressMismatch: boolean; cityConfirm: boolean; unverified: boolean } {
  if (!input.stored.read) return { addressMismatch: false, cityConfirm: false, unverified: true };
  const phoneSent = normalizedCustomerPhone(input.sentPhone) != null;
  const destination = classifyCourierDestination({
    order: input.order,
    provider: { pincode: input.stored.pin, city: input.stored.city, state: input.stored.state },
    canonicalCity: input.canonicalCity,
    aliases: input.aliases,
  });
  if (destination.verdict === "fail") return { addressMismatch: true, cityConfirm: false, unverified: false };
  if (input.provider === "shiprocket" && !input.stored.phoneStored) {
    return { addressMismatch: true, cityConfirm: false, unverified: false };
  }
  if (input.provider === "delhivery" && !phoneSent) {
    return { addressMismatch: true, cityConfirm: false, unverified: false };
  }
  if (destination.verdict === "confirm") return { addressMismatch: false, cityConfirm: true, unverified: false };
  return { addressMismatch: false, cityConfirm: false, unverified: false };
}

export function formatDestinationLine(city: string, state: string, pincode: string): string {
  return `${city}, ${state} — ${pincode}`;
}

export function cityConfirmationView(input: {
  orderCity: string;
  orderState: string;
  providerCity: string;
  providerState: string;
  pincode: string;
}): { customer: string; courier: string; pin: "MATCH"; state: "MATCH" } {
  return {
    customer: formatDestinationLine(input.orderCity, input.orderState, input.pincode),
    courier: formatDestinationLine(input.providerCity, input.providerState, input.pincode),
    pin: "MATCH",
    state: "MATCH",
  };
}

/** Selected quote stored beside the shipment. This is not a provider invoice. */
export function shipmentQuoteAudit(input: {
  ratePaise: number;
  provider: string;
  courier: string;
  service: string;
  selectedAt: string;
  selectedBy: string;
}): {
  quoted_rate_paise: number;
  booked_rate_paise: number;
  provider: string;
  courier: string;
  service: string;
  selected_at: string;
  selected_by: string;
  rate_paise: number;
} {
  return {
    quoted_rate_paise: input.ratePaise,
    booked_rate_paise: input.ratePaise,
    provider: input.provider,
    courier: input.courier,
    service: input.service,
    selected_at: input.selectedAt,
    selected_by: input.selectedBy,
    rate_paise: input.ratePaise,
  };
}
