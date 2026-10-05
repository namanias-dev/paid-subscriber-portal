/**
 * Place of supply for a Notes invoice: one rule, not spread across PDF code.
 *
 * DELIVERY: the delivery (shipping) address state, exactly as before Academy Pickup.
 * ACADEMY_PICKUP: INTERIM rule pending accountant/CA confirmation (DECISION_LOG
 * 2026-10-05): the customer's own state from the server-normalized PIN location they
 * gave at checkout. Every Notes product sold today is nil-rated, so the rule changes
 * no tax amount; a taxable pickup line is refused before payment (see
 * `pickupTaxSupported`) and again here, until a pickup tax policy is approved.
 */
import { isAcademyPickup } from "../fulfillment";

export type PlaceOfSupplySource = "delivery_address" | "pickup_customer_location_interim" | "unknown";

export function placeOfSupplyFor(
  order: { fulfillment_method?: string | null; customer_location_snapshot?: unknown },
  shippingAddress: { state?: string | null } | null | undefined,
): { state: string | null; source: PlaceOfSupplySource } {
  if (isAcademyPickup(order)) {
    const loc = order.customer_location_snapshot && typeof order.customer_location_snapshot === "object"
      ? (order.customer_location_snapshot as { state?: unknown })
      : null;
    const state = typeof loc?.state === "string" && loc.state.trim() ? loc.state.trim() : null;
    return { state, source: state ? "pickup_customer_location_interim" : "unknown" };
  }
  const state = shippingAddress?.state?.trim() || null;
  return { state, source: state ? "delivery_address" : "unknown" };
}

/**
 * Pickup is offered only for lines whose pickup tax handling is settled. Until the CA
 * approves a pickup place-of-supply policy, that means nil/exempt (0%) lines only.
 */
export function pickupTaxSupported(lines: Array<{ tax_rate_bps?: number | null; taxRateBps?: number | null; tax_treatment?: string | null }>): boolean {
  return lines.every((line) => Number(line.tax_rate_bps ?? line.taxRateBps ?? 0) === 0 && line.tax_treatment !== "taxable");
}
