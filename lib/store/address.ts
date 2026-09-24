/**
 * The address the customer gave. A courier hub or routing locality is stored
 * beside it and must not replace these fields.
 */
export interface CanonicalAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface CourierRouting {
  hub: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export function customerShipTo(address: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}): string {
  return [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(", ");
}

function place(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");
}

/** Ask the customer to confirm when the city or state does not match the PIN. Street lines are left untouched. */
export function pinPlaceConflict(
  enteredCity: string,
  enteredState: string,
  postalCity: string | null,
  postalState: string | null,
): string | null {
  if (!postalCity || !postalState) return null;
  const city = place(enteredCity);
  const state = place(enteredState);
  if (!city || !state) return null;
  const postalCityKey = place(postalCity);
  const postalStateKey = place(postalState);
  const cityOk = city === postalCityKey || postalCityKey.includes(city) || city.includes(postalCityKey);
  const stateOk = state === postalStateKey || postalStateKey.includes(state) || state.includes(postalStateKey);
  if (cityOk && stateOk) return null;
  return `This PIN is ${postalCity}, ${postalState}. Confirm the city and state before paying.`;
}

/** Routing metadata stays beside the canonical address. It does not rewrite it. */
export function keepCanonicalAddress(address: CanonicalAddress, _routing: CourierRouting): CanonicalAddress {
  return address;
}

export const SHIPMENT_ADDRESS_MISMATCH = "SHIPMENT_ADDRESS_MISMATCH";

/**
 * True when the courier stored a different PIN, city, or state from the order.
 * A hub name is not compared. Pickup and label approval must stop when this is true.
 */
/** Block label approval, pickup, and handoff when the courier record disagrees with the order. */
export function shipmentHandoffBlocked(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload) return false;
  if (payload.address_mismatch === true || payload.do_not_handoff === true) return true;
  const requestedPin = String(payload.requested_pin || "").trim();
  const storedPin = String(payload.provider_pin || "").trim();
  if (requestedPin && storedPin && requestedPin !== storedPin) return true;
  const requestedCity = String(payload.requested_city || "").trim();
  const storedCity = String(payload.provider_city || "").trim();
  if (requestedCity && storedCity && place(requestedCity) !== place(storedCity)) return true;
  const requestedState = String(payload.requested_state || "").trim();
  const storedState = String(payload.provider_state || "").trim();
  if (requestedState && storedState && place(requestedState) !== place(storedState)) return true;
  return false;
}

export function providerDestinationMismatch(
  canonical: { city: string; state: string; pincode: string },
  stored: { city?: string | null; state?: string | null; pincode?: string | null },
): boolean {
  const storedPin = String(stored.pincode || "").trim();
  if (!storedPin || storedPin !== canonical.pincode.trim()) return true;
  const storedCity = place(stored.city || "");
  const storedState = place(stored.state || "");
  if (!storedCity || !storedState) return true;
  return storedCity !== place(canonical.city) || storedState !== place(canonical.state);
}
