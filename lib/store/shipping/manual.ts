/**
 * Manual shipping provider — Phase 1, production-ready.
 *
 * Staff enter the courier and AWB after handing the parcel to a courier; this
 * provider records exactly that. It calls no external API and is always
 * available, so the Notes Store is fully operational before any aggregator
 * integration exists.
 */
import type { CreateShipmentInput, ShipmentResult, ShippingProvider } from "./types";

export const manualShippingProvider: ShippingProvider = {
  name: "manual",
  isConfigured() {
    return true;
  },
  async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
    const awb = (input.awb || "").trim();
    if (!awb) throw new Error("AWB required");
    return {
      provider: "manual",
      awb,
      courierName: (input.courierName || "Manual").trim(),
      trackingUrl: (input.trackingUrl || "").trim() || null,
      status: "in_transit",
    };
  },
};
