/**
 * Fulfilment methods: courier DELIVERY and customer ACADEMY_PICKUP.
 *
 * One typed source for the method values, the status sets the database enforces
 * (supabase/migrations/2026-10-05-notes-store-academy-pickup.sql), the pickup ladder,
 * the staff transition matrix and the next-action copy. Pure and client-safe.
 *
 * Vocabulary: "pickup" in a status always means the COURIER collecting a parcel
 * (READY_FOR_PICKUP, PICKUP_SCHEDULED, PICKED_UP). A customer collecting from the
 * academy uses COLLECTION wording (READY_FOR_COLLECTION, COLLECTED).
 */
import { STAFF_NEXT } from "./stages";

export const FULFILLMENT_METHODS = ["DELIVERY", "ACADEMY_PICKUP"] as const;
export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number];
export const DEFAULT_FULFILLMENT_METHOD: FulfillmentMethod = "DELIVERY";
export const DELIVERY: FulfillmentMethod = "DELIVERY";
export const ACADEMY_PICKUP: FulfillmentMethod = "ACADEMY_PICKUP";

export const METHOD_LABEL: Record<FulfillmentMethod, string> = {
  DELIVERY: "Delivery",
  ACADEMY_PICKUP: "Academy Pickup",
};

export const METHOD_BADGE: Record<FulfillmentMethod, string> = {
  DELIVERY: "DELIVERY",
  ACADEMY_PICKUP: "ACADEMY PICKUP",
};

/** URL/filter key for each method (`?fulfillment=`). */
export const METHOD_FILTER_KEY: Record<FulfillmentMethod, string> = {
  DELIVERY: "delivery",
  ACADEMY_PICKUP: "academy_pickup",
};

export function parseFulfillmentMethod(value: unknown): FulfillmentMethod | null {
  const v = String(value ?? "").trim().toUpperCase();
  return (FULFILLMENT_METHODS as readonly string[]).includes(v) ? (v as FulfillmentMethod) : null;
}

export function methodFromFilterKey(value: unknown): FulfillmentMethod | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "delivery") return "DELIVERY";
  if (v === "academy_pickup") return "ACADEMY_PICKUP";
  return null;
}

/** Orders written before the column existed (or rows read without it) are DELIVERY. */
export function orderMethod(order: { fulfillment_method?: string | null } | null | undefined): FulfillmentMethod {
  return parseFulfillmentMethod(order?.fulfillment_method) || DEFAULT_FULFILLMENT_METHOD;
}

export function isAcademyPickup(order: { fulfillment_method?: string | null } | null | undefined): boolean {
  return orderMethod(order) === "ACADEMY_PICKUP";
}

// ------------------------------------------------------------------ status sets (mirror the DB)

export const COLLECTION_STATUSES = ["READY_FOR_COLLECTION", "COLLECTED"] as const;

export const DELIVERY_ONLY_STATUSES = [
  "PACKED",
  "READY_FOR_PICKUP",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "DELIVERY_FAILED",
  "REATTEMPT_REQUESTED",
  "RTO_INITIATED",
  "RTO_IN_TRANSIT",
  "RTO_DELIVERED",
  "RETURN_PICKUP_SCHEDULED",
  "RETURN_IN_TRANSIT",
] as const;

/** Every value `store_orders.status` accepts. */
export const ALL_ORDER_STATUSES = [
  "PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED",
  "PAYMENT_CONFIRMED", "ORDER_CONFIRMED", "PROCESSING", "PRINTING",
  "QUALITY_CHECK", "READY_TO_PACK", "PACKED", "READY_FOR_PICKUP",
  "PICKUP_SCHEDULED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY",
  "DELIVERED", "DELIVERY_FAILED", "REATTEMPT_REQUESTED",
  "RTO_INITIATED", "RTO_IN_TRANSIT", "RTO_DELIVERED",
  "CANCEL_REQUESTED", "CANCELLED",
  "RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_PICKUP_SCHEDULED",
  "RETURN_IN_TRANSIT", "RETURN_RECEIVED",
  "REFUND_PENDING", "REFUNDED", "PARTIALLY_REFUNDED",
  "READY_FOR_COLLECTION", "COLLECTED",
] as const;

export function statusAllowedFor(method: FulfillmentMethod, status: string): boolean {
  if (!(ALL_ORDER_STATUSES as readonly string[]).includes(status)) return false;
  if (method === "DELIVERY") return !(COLLECTION_STATUSES as readonly string[]).includes(status);
  return !(DELIVERY_ONLY_STATUSES as readonly string[]).includes(status);
}

export function isCollectionStatus(status: string): boolean {
  return (COLLECTION_STATUSES as readonly string[]).includes(status);
}

// ------------------------------------------------------------------ pickup ladder

export const PICKUP_PROGRESS = [
  { key: "confirmed", admin: "New", customer: "Order confirmed", statuses: ["ORDER_CONFIRMED", "PAYMENT_CONFIRMED"] },
  { key: "preparing", admin: "Preparing", customer: "Preparing your notes", statuses: ["PROCESSING"] },
  { key: "printing", admin: "Printing", customer: "Printing your notes", statuses: ["PRINTING", "QUALITY_CHECK", "READY_TO_PACK"] },
  { key: "ready", admin: "Ready for collection", customer: "Ready for collection", statuses: ["READY_FOR_COLLECTION"] },
  { key: "collected", admin: "Collected", customer: "Collected", statuses: ["COLLECTED"] },
] as const;

const PICKUP_INDEX = new Map<string, number>();
for (const [index, step] of PICKUP_PROGRESS.entries()) {
  for (const status of step.statuses) PICKUP_INDEX.set(status, index);
}

export function pickupProgressIndex(status: string): number | null {
  const index = PICKUP_INDEX.get(status);
  return index == null ? null : index;
}

// ------------------------------------------------------------------ staff transitions

/** Pickup staff steps through `advance`. READY_FOR_COLLECTION → COLLECTED has its own confirmed action. */
export const PICKUP_STAFF_NEXT: Record<string, string> = {
  ORDER_CONFIRMED: "PROCESSING",
  PAYMENT_CONFIRMED: "PROCESSING",
  PROCESSING: "PRINTING",
  PRINTING: "READY_FOR_COLLECTION",
  QUALITY_CHECK: "READY_FOR_COLLECTION",
  READY_TO_PACK: "READY_FOR_COLLECTION",
};

/** The one transition matrix every admin button and route derives from. */
export function staffNextStatusFor(status: string, method: FulfillmentMethod): string | null {
  const table = method === "ACADEMY_PICKUP" ? PICKUP_STAFF_NEXT : STAFF_NEXT;
  return table[status] || null;
}

export function staffAdvanceLabelFor(status: string, method: FulfillmentMethod): string | null {
  const next = staffNextStatusFor(status, method);
  if (next === "PROCESSING") return "Start preparing";
  if (next === "PRINTING") return "Start printing";
  if (next === "PACKED") return "Mark packed";
  if (next === "READY_FOR_COLLECTION") return "Mark ready for collection";
  return null;
}

/** Pickup orders are handed over only from READY_FOR_COLLECTION. */
export function canMarkCollected(order: { status: string; fulfillment_method?: string | null }): boolean {
  return isAcademyPickup(order) && order.status === "READY_FOR_COLLECTION";
}

export interface NextAction {
  /** Short instruction for staff, or null when nothing is pending. */
  label: string | null;
  complete: boolean;
}

/** Shared next-step copy. React components read this instead of writing their own. */
export function nextActionFor(status: string, method: FulfillmentMethod): NextAction {
  if (method === "ACADEMY_PICKUP") {
    if (status === "ORDER_CONFIRMED" || status === "PAYMENT_CONFIRMED") return { label: "Start preparing", complete: false };
    if (status === "PROCESSING") return { label: "Start printing", complete: false };
    if (status === "PRINTING" || status === "QUALITY_CHECK" || status === "READY_TO_PACK") return { label: "Mark ready for collection", complete: false };
    if (status === "READY_FOR_COLLECTION") return { label: "Hand over and mark collected", complete: false };
    if (status === "COLLECTED") return { label: null, complete: true };
    return { label: null, complete: false };
  }
  if (status === "ORDER_CONFIRMED" || status === "PAYMENT_CONFIRMED") return { label: "Start preparing", complete: false };
  if (status === "PROCESSING") return { label: "Start printing", complete: false };
  if (status === "PRINTING" || status === "QUALITY_CHECK" || status === "READY_TO_PACK") return { label: "Mark packed", complete: false };
  if (status === "PACKED" || status === "READY_FOR_PICKUP") return { label: "Compare couriers", complete: false };
  if (status === "PICKUP_SCHEDULED") return { label: "Wait for courier pickup", complete: false };
  if (status === "DELIVERED") return { label: null, complete: true };
  return { label: null, complete: false };
}

// ------------------------------------------------------------------ ready age

export interface ReadyAge {
  hours: number;
  days: number;
  /** "Waiting 3 h", "Waiting 1 day", "Waiting 4 days". Descriptive only, never "overdue". */
  label: string;
  tone: "neutral" | "amber" | "strong";
}

export function readyAge(readyAt: string | null | undefined, now: Date = new Date()): ReadyAge | null {
  if (!readyAt) return null;
  const t = Date.parse(readyAt);
  if (!Number.isFinite(t)) return null;
  const ms = Math.max(0, now.getTime() - t);
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(ms / 86_400_000);
  const label = days >= 1 ? `Waiting ${days} ${days === 1 ? "day" : "days"}` : hours >= 1 ? `Waiting ${hours} h` : "Waiting under 1 h";
  const tone = days > 3 ? "strong" : days >= 1 ? "amber" : "neutral";
  return { hours, days, label, tone };
}
