/**
 * Shipping provider selection for the "mark shipped" action.
 *
 * That action records a courier and AWB the team already has. It must stay on
 * the manual provider. Live rate quotes live in `compare.ts` and never create
 * a label, AWB, or pickup. Turning `notes_store_shiprocket` on must not switch
 * this path onto an API that can bill a shipment.
 */
import { manualShippingProvider } from "./manual";
import type { ShippingProvider } from "./types";

export type { CreateShipmentInput, ShipmentResult, ShippingProvider } from "./types";
export { manualShippingProvider } from "./manual";
export { shiprocketProvider, shiprocketConfigured } from "./shiprocket";

export async function selectShippingProvider(): Promise<ShippingProvider> {
  return manualShippingProvider;
}
