/**
 * Shipping provider selection.
 *
 * Manual is the always-available default. An automated provider is used only
 * when its feature flag is on AND it is actually configured — otherwise we fall
 * back to manual so fulfilment is never blocked by a half-set-up integration.
 */
import { storeFeatureEnabled } from "../flags";
import { manualShippingProvider } from "./manual";
import { shiprocketProvider } from "./shiprocket";
import type { ShippingProvider } from "./types";

export type { CreateShipmentInput, ShipmentResult, ShippingProvider } from "./types";
export { manualShippingProvider } from "./manual";
export { shiprocketProvider, shiprocketConfigured } from "./shiprocket";

/**
 * Pick the active provider. Today this is always manual; when the Shiprocket
 * flag is enabled and credentials exist, it becomes the automated provider.
 */
export async function selectShippingProvider(): Promise<ShippingProvider> {
  if ((await storeFeatureEnabled("notes_store_shiprocket")) && shiprocketProvider.isConfigured()) {
    return shiprocketProvider;
  }
  return manualShippingProvider;
}
