/**
 * Notes Store availability model (spec §5).
 *
 * A product is sold in one of four modes, orthogonal to `is_active` (draft/live):
 *
 *   ready_stock — physical copies on hand; purchasable while sellable ≥ 1.
 *   on_demand   — printed/prepared per order; always purchasable when live, with
 *                 NO fake inventory number. Paid orders become preparation demand.
 *   coming_soon — visible, not purchasable.
 *   unavailable — not purchasable (temporarily off).
 *
 * These helpers are pure so both the storefront and the checkout/quote path make
 * the same decision, and so they can be unit-tested without a database.
 */

export type AvailabilityMode = "ready_stock" | "on_demand" | "coming_soon" | "unavailable";

export type AvailabilityState =
  | "in_stock"
  | "low_stock"
  | "out_of_stock"
  | "on_demand"
  | "coming_soon"
  | "unavailable"
  | "draft";

export interface AvailabilityView {
  mode: AvailabilityMode;
  state: AvailabilityState;
  /** Customer-facing label — never leaks the internal "print on demand" wording. */
  label: string;
  /** Short admin-facing label (internal terms allowed). */
  adminLabel: string;
  /** Whether a customer may add this to cart / check out right now. */
  purchasable: boolean;
  /** True only for ready_stock nearing its low-stock threshold. */
  lowStock: boolean;
}

export function isAvailabilityMode(v: unknown): v is AvailabilityMode {
  return v === "ready_stock" || v === "on_demand" || v === "coming_soon" || v === "unavailable";
}

export function normalizeAvailabilityMode(v: unknown): AvailabilityMode {
  return isAvailabilityMode(v) ? v : "ready_stock";
}

export const AVAILABILITY_ADMIN_LABEL: Record<AvailabilityMode, string> = {
  ready_stock: "Ready Stock",
  on_demand: "Available on Demand",
  coming_soon: "Coming Soon",
  unavailable: "Unavailable",
};

/**
 * Resolve the full availability view for a product.
 *
 * @param mode      availability_mode
 * @param sellable  on_hand - reserved (only meaningful for ready_stock)
 * @param lowStockThreshold  ready_stock low-stock cutoff
 * @param isActive  product is live (not a draft/hidden)
 */
export function resolveAvailability(
  mode: AvailabilityMode,
  sellable: number,
  lowStockThreshold: number,
  isActive: boolean,
): AvailabilityView {
  const adminLabel = AVAILABILITY_ADMIN_LABEL[mode];
  const base = { mode, adminLabel, lowStock: false } as const;

  if (!isActive) {
    return { ...base, state: "draft", label: "Not available", purchasable: false, lowStock: false };
  }

  switch (mode) {
    case "coming_soon":
      return { ...base, state: "coming_soon", label: "Coming soon", purchasable: false };
    case "unavailable":
      return { ...base, state: "unavailable", label: "Currently unavailable", purchasable: false };
    case "on_demand":
      // Always purchasable when live; stock counter is irrelevant.
      return { ...base, state: "on_demand", label: "Available to order", purchasable: true };
    case "ready_stock":
    default: {
      const s = Math.max(0, Math.floor(sellable));
      if (s < 1) {
        return { ...base, state: "out_of_stock", label: "Out of stock", purchasable: false };
      }
      const low = s <= Math.max(0, Math.floor(lowStockThreshold));
      return {
        ...base,
        state: low ? "low_stock" : "in_stock",
        label: low ? `Only ${s} left` : "In stock",
        purchasable: true,
        lowStock: low,
      };
    }
  }
}

/**
 * The maximum quantity a customer may put in the cart for one product, given its
 * availability. ready_stock is capped by sellable stock AND the per-order max;
 * on_demand is capped by the per-order max only (no stock ceiling).
 */
export function maxPurchasableQty(mode: AvailabilityMode, sellable: number, maxPerOrder: number): number {
  const cap = Math.max(1, Math.floor(maxPerOrder));
  if (mode === "on_demand") return cap;
  if (mode === "ready_stock") return Math.max(0, Math.min(cap, Math.floor(sellable)));
  return 0; // coming_soon / unavailable
}

/** Order statuses that represent PAID but NOT-YET-DISPATCHED demand (spec §21). */
export const PREPARATION_STATUSES = [
  "PAYMENT_CONFIRMED",
  "ORDER_CONFIRMED",
  "PROCESSING",
  "PRINTING",
  "QUALITY_CHECK",
  "READY_TO_PACK",
  "PACKED",
  "READY_FOR_PICKUP",
  "PICKUP_SCHEDULED",
] as const;

/** Statuses that count as "still open / awaiting fulfilment" for admin buckets. */
export function isPreparationStatus(status: string): boolean {
  return (PREPARATION_STATUSES as readonly string[]).includes(status);
}
