/** Admin operations classification. Payment capture and fulfilment stage stay separate. */

const NOT_COLLECTED = new Set(["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"]);

export const AUTO_PREPARE_AFTER_MS = 5 * 60 * 1000;

/** Statuses the queue already labels "New". Only these can auto-advance. */
export const NEW_FULFILLMENT_STATUSES = ["PAYMENT_CONFIRMED", "ORDER_CONFIRMED"] as const;

export const TIMELINE = [
  { key: "new", label: "New" },
  { key: "preparing", label: "Preparing" },
  { key: "printing", label: "Printing" },
  { key: "packed", label: "Packed" },
  { key: "pickup", label: "Pickup" },
  { key: "transit", label: "In transit" },
  { key: "delivered", label: "Delivered" },
] as const;

const STAGE: Record<string, number> = {
  PAYMENT_CONFIRMED: 0,
  ORDER_CONFIRMED: 0,
  PROCESSING: 1,
  PRINTING: 2,
  QUALITY_CHECK: 2,
  READY_TO_PACK: 2,
  PACKED: 3,
  READY_FOR_PICKUP: 3,
  PICKUP_SCHEDULED: 4,
  PICKED_UP: 5,
  IN_TRANSIT: 5,
  OUT_FOR_DELIVERY: 5,
  DELIVERED: 6,
};

export function timelineIndex(status: string): number | null {
  return Object.prototype.hasOwnProperty.call(STAGE, status) ? STAGE[status] : null;
}

export function showsFulfillmentTimeline(status: string): boolean {
  return timelineIndex(status) != null;
}

export interface PaidRollup {
  orders: number;
  salesPaise: number;
}

/** Same capture rule as commerce reporting: paid_at set, and not unpaid/cancelled/refunded. */
export function paidRollup(rows: Array<{ status: string; paid_at: string | null; total_paise: number }>): PaidRollup {
  let orders = 0;
  let salesPaise = 0;
  for (const row of rows) {
    if (!row.paid_at || NOT_COLLECTED.has(row.status)) continue;
    orders += 1;
    salesPaise += Number(row.total_paise) || 0;
  }
  return { orders, salesPaise };
}

export interface AutoPrepareOrder {
  status: string;
  paid_at: string | null;
}

export function eligibleForAutoPrepare(order: AutoPrepareOrder, nowMs: number): boolean {
  if (!NEW_FULFILLMENT_STATUSES.includes(order.status as (typeof NEW_FULFILLMENT_STATUSES)[number])) return false;
  if (!order.paid_at) return false;
  const paidAt = new Date(order.paid_at).getTime();
  if (!Number.isFinite(paidAt)) return false;
  return nowMs - paidAt >= AUTO_PREPARE_AFTER_MS;
}

/** In-memory transition used by tests and mirrored by the cron's conditional update. */
export function autoPrepareOnce<T extends AutoPrepareOrder>(orders: T[], nowMs: number): T[] {
  return orders.map((order) =>
    eligibleForAutoPrepare(order, nowMs) ? { ...order, status: "PROCESSING" } : order,
  );
}
