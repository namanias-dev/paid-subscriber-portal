/**
 * Shiprocket provider — Phase 2 boundary (spec §10).
 *
 * Intentionally NOT implemented against the live API yet: it requires a
 * Shiprocket account and credentials the owner has not provisioned. Rather than
 * fake it, this is an honest, self-declaring boundary — `isConfigured()` returns
 * false until the env is present, and `createShipment` throws a clear error. When
 * the account exists, implement auth + createShipment here and flip the provider
 * selection via the `notes_store_shiprocket` flag; nothing else changes.
 */
import type { CreateShipmentInput, ShipmentResult, ShippingProvider } from "./types";

/** Env var NAMES only — never values, never committed. */
const REQUIRED_ENV = ["SHIPROCKET_EMAIL", "SHIPROCKET_PASSWORD"] as const;

export function shiprocketConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return REQUIRED_ENV.every((k) => (env[k] || "").trim().length > 0);
}

export const shiprocketProvider: ShippingProvider = {
  name: "shiprocket",
  isConfigured() {
    return shiprocketConfigured();
  },
  async createShipment(_input: CreateShipmentInput): Promise<ShipmentResult> {
    throw new Error(
      "Shiprocket shipment creation is disabled. Record the courier and AWB manually. Rate quotes do not create a label or pickup.",
    );
  },
};
