/**
 * One courier, chosen by staff. This module never picks a second courier.
 */
import { resolveAutoPackage, type PackageLine } from "./autoFulfill";

export interface SelectedCourier {
  provider: "shiprocket" | "delhivery";
  courier: string;
  service: string;
  courierId: string | null;
  ratePaise: number;
}

export interface SelectedCreated {
  awb: string | null;
  labelUrl: string | null;
  providerOrderId: string | null;
  providerShipmentId: string | null;
  courierName: string | null;
  addressMismatch: boolean;
  unverified: boolean;
  possessed: boolean;
}

export interface ManualBookResult {
  ok: boolean;
  awb: string | null;
  labelUrl: string | null;
  providerOrderId: string | null;
  providerShipmentId: string | null;
  courierName: string | null;
  pickupRequested: boolean;
  creates: number;
  blocked: "EXISTING_AWB" | "BOOKING_FAILED" | "PICKUP_PENDING" | null;
  message: string;
}

export function resolveBookingPackage(input: {
  override: { weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null } | null;
  lines: PackageLine[];
}): { ok: true; source: "STAFF_OVERRIDE" | "PRODUCT_PROFILE"; weightGrams: number; lengthCm: number; widthCm: number; heightCm: number } | { ok: false; reason: "PACKAGE_CONFIRMATION_REQUIRED" } {
  const saved = input.override;
  if (saved?.weightGrams && saved.lengthMm && saved.widthMm && saved.heightMm) {
    return {
      ok: true,
      source: "STAFF_OVERRIDE",
      weightGrams: saved.weightGrams,
      lengthCm: saved.lengthMm / 10,
      widthCm: saved.widthMm / 10,
      heightCm: saved.heightMm / 10,
    };
  }
  const resolved = resolveAutoPackage(input.lines);
  if (!resolved.ok) return resolved;
  return { source: "PRODUCT_PROFILE", ...resolved };
}

/** Cancelled rows stay in history. Staff print only the live shipment. */
export function printableShipment<T extends { status: string | null; awb: string | null }>(rows: T[]): T | null {
  return rows.find((row) => row.awb && row.status !== "cancelled" && row.status !== "failed") || null;
}

export function packageSurvivesCancellation<T extends { weight_grams: number | null; length_mm: number | null; width_mm: number | null; height_mm: number | null }>(row: T): T {
  return { ...row };
}

/**
 * Book the courier staff selected. A failure returns to the list.
 * A second provider is never created from here.
 */
export async function bookSelectedCourier(input: {
  selected: SelectedCourier;
  activeAwb: string | null;
  create: () => Promise<SelectedCreated>;
  cancel: (created: SelectedCreated) => Promise<boolean>;
  requestPickup: (created: SelectedCreated) => Promise<void>;
}): Promise<ManualBookResult> {
  const name = input.selected.courier || "The selected courier";
  if (input.activeAwb) {
    return {
      ok: false,
      awb: input.activeAwb,
      labelUrl: null,
      providerOrderId: null,
      providerShipmentId: null,
      courierName: null,
      pickupRequested: false,
      creates: 0,
      blocked: "EXISTING_AWB",
      message: "This order already has an active shipment.",
    };
  }
  let created: SelectedCreated;
  try {
    created = await input.create();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    return {
      ok: false,
      awb: null,
      labelUrl: null,
      providerOrderId: null,
      providerShipmentId: null,
      courierName: name,
      pickupRequested: false,
      creates: 0,
      blocked: "BOOKING_FAILED",
      message: detail ? `${name} could not be booked. ${detail}` : `${name} could not be booked.`,
    };
  }
  if (created.possessed || created.addressMismatch || created.unverified || !created.awb) {
    const cancelled = await input.cancel(created);
    const why = created.addressMismatch || created.unverified
      ? "The courier address check did not pass."
      : created.possessed
        ? "The courier may already have the parcel."
        : "No AWB was returned.";
    if (!cancelled && created.awb) {
      return {
        ok: false,
        awb: created.awb,
        labelUrl: created.labelUrl,
        providerOrderId: created.providerOrderId,
        providerShipmentId: created.providerShipmentId,
        courierName: created.courierName || name,
        pickupRequested: false,
        creates: 1,
        blocked: "EXISTING_AWB",
        message: `${name} could not be booked. ${why} The shipment could not be cancelled, so no second shipment was created.`,
      };
    }
    return {
      ok: false,
      awb: created.awb,
      labelUrl: null,
      providerOrderId: created.providerOrderId,
      providerShipmentId: created.providerShipmentId,
      courierName: created.courierName || name,
      pickupRequested: false,
      creates: 1,
      blocked: "BOOKING_FAILED",
      message: `${name} could not be booked. ${why}`,
    };
  }
  try {
    await input.requestPickup(created);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Pickup was not requested.";
    return {
      ok: true,
      awb: created.awb,
      labelUrl: created.labelUrl,
      providerOrderId: created.providerOrderId,
      providerShipmentId: created.providerShipmentId,
      courierName: created.courierName || name,
      pickupRequested: false,
      creates: 1,
      blocked: "PICKUP_PENDING",
      message: detail,
    };
  }
  return {
    ok: true,
    awb: created.awb,
    labelUrl: created.labelUrl,
    providerOrderId: created.providerOrderId,
    providerShipmentId: created.providerShipmentId,
    courierName: created.courierName || name,
    pickupRequested: true,
    creates: 1,
    blocked: null,
    message: "Courier booked.",
  };
}
