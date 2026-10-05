/** Admin operations classification. Payment capture and fulfilment stage stay separate. */

import { PROGRESS, progressIndex } from "@/lib/store/stages";
import { PICKUP_PROGRESS, pickupProgressIndex, type FulfillmentMethod } from "@/lib/store/fulfillment";

const NOT_COLLECTED = new Set(["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"]);

export const AUTO_PREPARE_AFTER_MS = 5 * 60 * 1000;

/** Statuses the queue already labels "New". Only these can auto-advance. */
export const NEW_FULFILLMENT_STATUSES = ["PAYMENT_CONFIRMED", "ORDER_CONFIRMED"] as const;

export const TIMELINE = PROGRESS.map((step) => ({ key: step.key, label: step.admin }));
export const PICKUP_TIMELINE = PICKUP_PROGRESS.map((step) => ({ key: step.key, label: step.admin }));

export function timelineFor(method: FulfillmentMethod = "DELIVERY") {
  return method === "ACADEMY_PICKUP" ? PICKUP_TIMELINE : TIMELINE;
}

export function timelineIndex(status: string, method: FulfillmentMethod = "DELIVERY"): number | null {
  return method === "ACADEMY_PICKUP" ? pickupProgressIndex(status) : progressIndex(status);
}

export function showsFulfillmentTimeline(status: string, method: FulfillmentMethod = "DELIVERY"): boolean {
  return timelineIndex(status, method) != null;
}

export interface StageProgress {
  key: string;
  label: string;
  index: number;
  /** 1-based rung on the ladder, as staff read it ("4 of 9"). */
  position: number;
  total: number;
  final: boolean;
  ariaLabel: string;
}

/** Badge, dots and filter buckets all read the same ladder for the order's method. */
export function stageProgress(status: string, method: FulfillmentMethod = "DELIVERY"): StageProgress | null {
  const timeline = timelineFor(method);
  const index = timelineIndex(status, method);
  if (index == null) return null;
  const step = timeline[index];
  const final = index === timeline.length - 1;
  return {
    key: step.key,
    label: step.label,
    index,
    position: index + 1,
    total: timeline.length,
    final,
    ariaLabel: `${step.label}. Stage ${index + 1} of ${timeline.length}.`,
  };
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
