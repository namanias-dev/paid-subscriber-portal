/**
 * Shipping-provider abstraction (spec §10/§23).
 *
 * Phase 1 fulfilment is manual (courier + AWB typed in), but the checkout/order
 * flow must never be coupled to a specific courier SDK. Every provider — the
 * manual one today, a Shiprocket/Delhivery/etc. one later — implements this
 * interface, so adding automation is additive and does not touch orders.
 */

export interface CreateShipmentInput {
  orderId: string;
  /** Manual/entry providers require these; automated providers may generate them. */
  awb?: string;
  courierName?: string;
  trackingUrl?: string;
}

export interface ShipmentResult {
  provider: string;
  awb: string;
  courierName: string;
  trackingUrl: string | null;
  /** Store shipment status (matches store_shipments.status vocabulary). */
  status: string;
}

export interface ShippingProvider {
  readonly name: string;
  /** True when this provider can operate (creds/config present). */
  isConfigured(): boolean;
  /**
   * Create (or record) a shipment. Manual providers simply persist the entered
   * courier/AWB; automated providers call the aggregator and return the AWB.
   * Must throw a clear error rather than fabricate a shipment it cannot create.
   */
  createShipment(input: CreateShipmentInput): Promise<ShipmentResult>;
}
