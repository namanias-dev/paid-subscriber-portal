/**
 * Academy Pickup location: the single trusted source for the store.
 *
 * The browser never supplies academy details. Checkout loads this record, checks the
 * customer acknowledged the same fingerprint, and freezes a snapshot on the order, so
 * a later move or edit never rewrites what an existing customer was promised.
 *
 * The postal PIN is deliberately unset: the invoice seller PIN on file (160030) and the
 * public Sector 17C address have not been reconciled. The address plus the map link is
 * precise enough for collection. Pure and client-safe.
 */

export interface PickupLocation {
  code: string;
  name: string;
  addressLines: string[];
  city: string;
  state: string;
  country: "IN";
  pincode: string | null;
  mapsUrl: string;
  phoneDisplay: string;
  phoneTel: string;
}

export interface PickupLocationSnapshot {
  code: string;
  name: string;
  address_lines: string[];
  city: string;
  state: string;
  country: string;
  pincode: string | null;
  maps_url: string;
  phone: string;
  phone_tel: string;
  fingerprint: string;
  snapshot_at: string;
}

export const PICKUP_LOCATIONS: Record<string, PickupLocation> = {
  CHD_17C: {
    code: "CHD_17C",
    name: "Naman Sharma IAS Academy",
    addressLines: ["SCO 173–174, 2nd Floor", "Sector 17C, Chandigarh"],
    city: "Chandigarh",
    state: "Chandigarh",
    country: "IN",
    pincode: null,
    mapsUrl: "https://maps.app.goo.gl/BSA5hDQhBMKxKTbg6",
    phoneDisplay: "+91 84376 86541",
    phoneTel: "+918437686541",
  },
};

export const DEFAULT_PICKUP_LOCATION_CODE = "CHD_17C";

/** Problems that make a location unusable. An empty list means it can be offered. */
export function pickupLocationProblems(location: PickupLocation | null | undefined): string[] {
  if (!location) return ["missing"];
  const problems: string[] = [];
  if (!/^[A-Z0-9_]{3,32}$/.test(location.code || "")) problems.push("code");
  if (!location.name?.trim()) problems.push("name");
  if (!location.addressLines?.length || location.addressLines.some((line) => !line.trim())) problems.push("address");
  if (!location.city?.trim() || !location.state?.trim()) problems.push("place");
  if (!/^https:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps|goo\.gl\/maps)\//.test(location.mapsUrl || "")) problems.push("maps_url");
  if (!/^\+91[6-9]\d{9}$/.test(location.phoneTel || "")) problems.push("phone");
  if (location.pincode != null && !/^[1-9]\d{5}$/.test(location.pincode)) problems.push("pincode");
  return problems;
}

/** Stable, dependency-free fingerprint (FNV-1a 32-bit) of every customer-visible field. */
export function pickupLocationFingerprint(location: PickupLocation): string {
  const text = [
    location.code,
    location.name,
    ...location.addressLines,
    location.city,
    location.state,
    location.pincode || "",
    location.mapsUrl,
    location.phoneTel,
  ].join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${location.code}:${hash.toString(16).padStart(8, "0")}`;
}

export type ActivePickupLocation =
  | { ok: true; location: PickupLocation; fingerprint: string }
  | { ok: false; problems: string[] };

export function activePickupLocation(code: string = DEFAULT_PICKUP_LOCATION_CODE): ActivePickupLocation {
  const location = PICKUP_LOCATIONS[code];
  const problems = pickupLocationProblems(location);
  if (problems.length || !location) return { ok: false, problems };
  return { ok: true, location, fingerprint: pickupLocationFingerprint(location) };
}

export function snapshotPickupLocation(location: PickupLocation, now: Date = new Date()): PickupLocationSnapshot {
  return {
    code: location.code,
    name: location.name,
    address_lines: [...location.addressLines],
    city: location.city,
    state: location.state,
    country: location.country,
    pincode: location.pincode,
    maps_url: location.mapsUrl,
    phone: location.phoneDisplay,
    phone_tel: location.phoneTel,
    fingerprint: pickupLocationFingerprint(location),
    snapshot_at: now.toISOString(),
  };
}

/** Null-safe read of an order's frozen snapshot. Never falls back to today's config. */
export function readPickupSnapshot(value: unknown): PickupLocationSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const lines = Array.isArray(v.address_lines) ? v.address_lines.filter((line): line is string => typeof line === "string" && Boolean(line.trim())) : [];
  if (typeof v.name !== "string" || !v.name.trim() || !lines.length) return null;
  const text = (key: string) => (typeof v[key] === "string" ? (v[key] as string) : "");
  return {
    code: text("code"),
    name: v.name,
    address_lines: lines,
    city: text("city"),
    state: text("state"),
    country: text("country") || "IN",
    pincode: typeof v.pincode === "string" && v.pincode ? v.pincode : null,
    maps_url: text("maps_url"),
    phone: text("phone"),
    phone_tel: text("phone_tel"),
    fingerprint: text("fingerprint"),
    snapshot_at: text("snapshot_at"),
  };
}

/** Copy-ready text for staff (WhatsApp/SMS by hand). Uses the order's own snapshot. */
export function readyForCollectionMessage(orderNo: string, snapshot: PickupLocationSnapshot | null): string {
  const where = snapshot ? `${snapshot.name}, ${snapshot.address_lines.join(", ")}` : "Naman Sharma IAS Academy, Chandigarh";
  return `Your Naman IAS Notes order ${orderNo} is ready for collection from ${where}. Please mention your order number and registered mobile when collecting.`;
}
