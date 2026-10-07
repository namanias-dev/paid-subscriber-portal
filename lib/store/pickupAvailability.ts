/**
 * Can a customer create an Academy Pickup order right now?
 *
 * Creation needs the master store switch, `notes_store_academy_pickup`, and a valid
 * location record. The flag gates creation only: existing pickup orders keep tracking,
 * invoices, staff actions and payment capture when it is off.
 *
 * A local process with the in-memory fixture can switch creation on with
 * NOTES_STORE_PICKUP_LOCAL=1. Vercel (preview shares the production database) and
 * production never honour it.
 */
import { storeFeatureEnabled } from "./flags";
import { localFixtureEnabled } from "./localFixture";
import { activePickupLocation, type PickupLocation } from "./pickupLocation";

export function localPickupOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!localFixtureEnabled(env)) return false;
  const v = (env.NOTES_STORE_PICKUP_LOCAL || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function pickupCreationEnabled(): Promise<boolean> {
  if (localPickupOverride()) return true;
  return storeFeatureEnabled("notes_store_academy_pickup");
}

export interface PickupOffer {
  available: boolean;
  location: {
    code: string;
    name: string;
    address_lines: string[];
    maps_url: string;
    phone: string;
    phone_tel: string;
    fingerprint: string;
  } | null;
}

function publicLocation(location: PickupLocation, fingerprint: string): NonNullable<PickupOffer["location"]> {
  return {
    code: location.code,
    name: location.name,
    address_lines: [...location.addressLines],
    maps_url: location.mapsUrl,
    phone: location.phoneDisplay,
    phone_tel: location.phoneTel,
    fingerprint,
  };
}

/** What the cart and checkout may show. Off flag or a bad location record: Delivery only. */
export async function pickupOffer(): Promise<PickupOffer> {
  const active = activePickupLocation();
  if (!active.ok) return { available: false, location: null };
  if (!(await pickupCreationEnabled())) return { available: false, location: null };
  return { available: true, location: publicLocation(active.location, active.fingerprint) };
}
