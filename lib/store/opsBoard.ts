/** Admin operations classification. Payment capture and fulfilment stage stay separate. */

import { PROGRESS, progressIndex } from "@/lib/store/stages";

const NOT_COLLECTED = new Set(["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"]);

export const AUTO_PREPARE_AFTER_MS = 5 * 60 * 1000;

/** Statuses the queue already labels "New". Only these can auto-advance. */
export const NEW_FULFILLMENT_STATUSES = ["PAYMENT_CONFIRMED", "ORDER_CONFIRMED"] as const;

export const TIMELINE = PROGRESS.map((step) => ({ key: step.key, label: step.admin }));

export function timelineIndex(status: string): number | null {
  return progressIndex(status);
}

export function showsFulfillmentTimeline(status: string): boolean {
  return timelineIndex(status) != null;
}

export interface StageProgress {
  key: string;
  label: string;
  index: number;
  total: number;
  final: boolean;
  ariaLabel: string;
}

/** Badge, dots and filter buckets all read the same ladder. */
export function stageProgress(status: string): StageProgress | null {
  const index = timelineIndex(status);
  if (index == null) return null;
  const step = TIMELINE[index];
  const final = index === TIMELINE.length - 1;
  const completed = final ? TIMELINE.length : index;
  return {
    key: step.key,
    label: step.label,
    index,
    total: TIMELINE.length,
    final,
    ariaLabel: `Current stage: ${step.label}. ${completed} of ${TIMELINE.length} stages completed.`,
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
