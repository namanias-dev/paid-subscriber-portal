/**
 * Courier pickup lifecycle — one normalized model shared by Delhivery and Shiprocket.
 *
 * The store overloads a single shipment `status` for three different things: the
 * ORDER fulfillment stage, the SHIPMENT/AWB lifecycle, and the COURIER PICKUP
 * REQUEST lifecycle. This module owns the third one only, and keeps provider
 * wording out of business/UI logic (spec §3, §6, §15).
 *
 * A pickup being cancelled is NOT the same as the shipment/AWB being cancelled
 * (§8). `normalizeCourierPickupStatus` tells those two apart, and
 * `reconcileCourierShipment` turns a provider fact into a safe local transition
 * that never regresses an order the carrier already holds (§13) and never lets a
 * superseded shipment's event touch the active one (§14).
 *
 * Everything here is pure and side-effect free so it can be unit-tested without a
 * database or a provider call. Nothing in this file issues a provider write.
 */

export const PICKUP_STATES = [
  "NOT_REQUESTED",
  "REQUESTED",
  "SCHEDULED",
  "CANCELLED",
  "FAILED",
  "PICKED_UP",
] as const;

export type PickupState = (typeof PICKUP_STATES)[number];

export type CourierProvider = "delhivery" | "shiprocket" | "manual";

/** Order statuses that mean the carrier already has (or had) the parcel. Monotonic after this point. */
export const POSSESSION_ORDER_STATUSES = new Set([
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "DELIVERY_FAILED",
  "REATTEMPT_REQUESTED",
  "RTO_INITIATED",
  "RTO_IN_TRANSIT",
  "RTO_DELIVERED",
  "RETURN_REQUESTED",
  "RETURN_APPROVED",
  "RETURN_PICKUP_SCHEDULED",
  "RETURN_IN_TRANSIT",
  "RETURN_RECEIVED",
  "REFUND_PENDING",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);

export interface NormalizedPickup {
  /** null when the raw status says nothing about pickup. */
  pickupState: PickupState | null;
  /** true only when the whole shipment/AWB is cancelled (Case B, §10), not just the pickup request (Case A, §9). */
  shipmentCancelled: boolean;
  /** Sanitized human reason, when the provider gave one. */
  reason: string | null;
}

function clean(raw: string | null | undefined): string {
  return (raw || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

/** Does this text talk about the shipment/AWB itself, not merely its pickup request? */
function mentionsShipmentScope(s: string): boolean {
  return (
    s.includes("shipment cancel") ||
    s.includes("order cancel") ||
    s.includes("awb cancel") ||
    s.includes("waybill cancel") ||
    s.includes("consignment cancel") ||
    s.includes("manifest cancel") ||
    s.includes("cancelled by seller") ||
    s.includes("canceled by seller")
  );
}

/**
 * Map a provider pickup status/remark to the normalized lifecycle. Provider strings
 * stay here; callers only ever see `PickupState` + `shipmentCancelled`.
 */
export function normalizeCourierPickupStatus(input: {
  provider: CourierProvider;
  rawStatus: string | null | undefined;
  rawRemark?: string | null;
}): NormalizedPickup {
  const s = clean(input.rawStatus);
  const remark = clean(input.rawRemark);
  const text = `${s} ${remark}`.trim();
  const reason = (input.rawRemark || input.rawStatus || "").toString().trim().slice(0, 180) || null;

  if (!text) return { pickupState: null, shipmentCancelled: false, reason: null };

  // Carrier possession wins over any later/earlier cancellation wording.
  if (
    /\bpicked up\b/.test(text) ||
    text.includes("pickup done") ||
    text.includes("pickup complete") ||
    text.includes("shipment picked") ||
    text.includes("bag picked")
  ) {
    return { pickupState: "PICKED_UP", shipmentCancelled: false, reason };
  }

  // Case B — the shipment/AWB itself is cancelled.
  if (mentionsShipmentScope(text)) {
    return { pickupState: "CANCELLED", shipmentCancelled: true, reason };
  }

  // Pickup exception / not done / failed — AWB stays valid, needs staff attention.
  if (
    text.includes("pickup not done") ||
    text.includes("not done") ||
    text.includes("pickup failed") ||
    text.includes("pickup exception") ||
    text.includes("pickup unsuccessful")
  ) {
    return { pickupState: "FAILED", shipmentCancelled: false, reason };
  }

  // Case A — the pickup request is cancelled/closed but the shipment can be re-requested.
  if (
    text.includes("pickup cancel") ||
    text.includes("pickup closed") ||
    text.includes("pickup rejected") ||
    text.includes("pickup withdrawn") ||
    text.includes("pickup deleted")
  ) {
    return { pickupState: "CANCELLED", shipmentCancelled: false, reason };
  }

  // Provider confirmed a scheduled pickup.
  if (
    text.includes("pickup scheduled") ||
    text.includes("pickup confirmed") ||
    text.includes("pickup assigned") ||
    text.includes("pickup open") ||
    text.includes("out for pickup")
  ) {
    return { pickupState: "SCHEDULED", shipmentCancelled: false, reason };
  }

  // Request acknowledged but not yet a confirmed scheduled pickup (§30 — "requested" ≠ "scheduled").
  if (
    text.includes("pickup requested") ||
    text.includes("pickup registered") ||
    text.includes("pickup generated") ||
    text.includes("pickup queued") ||
    text.includes("pickup pending") ||
    text.includes("awaiting pickup")
  ) {
    return { pickupState: "REQUESTED", shipmentCancelled: false, reason };
  }

  return { pickupState: null, shipmentCancelled: false, reason };
}

export interface LocalShipmentFacts {
  awb: string | null;
  /** Is this the canonical active shipment for the order? Superseded shipments never mutate order state (§14). */
  active: boolean;
  pickupState: PickupState;
}

export interface ProviderPickupFact {
  /** The AWB this fact is about. A mismatch means the event belongs to another (superseded) shipment. */
  awb: string | null;
  pickupState: PickupState | null;
  shipmentCancelled: boolean;
  reason?: string | null;
}

export type ReconcileIgnore =
  | "not_active"
  | "awb_mismatch"
  | "post_possession"
  | "no_signal"
  | "noop";

export interface ReconcileResult {
  changed: boolean;
  /** Proposed order status, or null to leave the order status untouched. */
  orderStatus: string | null;
  /** Proposed pickup state after reconciliation. */
  pickupState: PickupState;
  /** Case B: the local shipment should be cancelled/superseded before any rebooking (§10). */
  cancelShipment: boolean;
  /** Why no change was made (for audit), or null when a change is proposed. */
  ignored: ReconcileIgnore | null;
  reason: string | null;
}

function pickupTarget(fact: ProviderPickupFact): { orderStatus: string; pickupState: PickupState; cancelShipment: boolean } | null {
  if (fact.shipmentCancelled) return { orderStatus: "PACKED", pickupState: "CANCELLED", cancelShipment: true };
  switch (fact.pickupState) {
    case "CANCELLED":
      return { orderStatus: "READY_FOR_PICKUP", pickupState: "CANCELLED", cancelShipment: false };
    case "FAILED":
      return { orderStatus: "READY_FOR_PICKUP", pickupState: "FAILED", cancelShipment: false };
    case "REQUESTED":
      return { orderStatus: "READY_FOR_PICKUP", pickupState: "REQUESTED", cancelShipment: false };
    case "SCHEDULED":
      return { orderStatus: "PICKUP_SCHEDULED", pickupState: "SCHEDULED", cancelShipment: false };
    case "PICKED_UP":
      return { orderStatus: "PICKED_UP", pickupState: "PICKED_UP", cancelShipment: false };
    default:
      return null;
  }
}

/**
 * Deterministically repair local pickup/order state from a provider fact. Pure: it
 * decides, it does not write. The caller persists the proposal inside a transaction.
 *
 * Safety invariants:
 *  - a fact for a different AWB, or for a non-active shipment, never touches the order (§14, §88);
 *  - once the carrier has possession the order never regresses (§13, §103);
 *  - an identical repeated fact is a no-op, so webhooks/polls are idempotent (§21, §104).
 */
export function reconcileCourierShipment(
  order: { status: string },
  shipment: LocalShipmentFacts,
  fact: ProviderPickupFact,
): ReconcileResult {
  const keep = (ignored: ReconcileIgnore): ReconcileResult => ({
    changed: false,
    orderStatus: null,
    pickupState: shipment.pickupState,
    cancelShipment: false,
    ignored,
    reason: fact.reason ?? null,
  });

  if (!shipment.active) return keep("not_active");
  if (fact.awb && shipment.awb && fact.awb !== shipment.awb) return keep("awb_mismatch");

  const target = pickupTarget(fact);
  if (!target) return keep("no_signal");

  const possession = POSSESSION_ORDER_STATUSES.has(order.status) || shipment.pickupState === "PICKED_UP";
  const regresses = target.pickupState !== "PICKED_UP";
  if (possession && regresses) return keep("post_possession");

  const samePickup = target.pickupState === shipment.pickupState;
  const sameOrder = target.orderStatus === order.status;
  if (samePickup && sameOrder) return keep("noop");

  return {
    changed: true,
    orderStatus: target.orderStatus,
    pickupState: target.pickupState,
    cancelShipment: target.cancelShipment,
    ignored: null,
    reason: fact.reason ?? null,
  };
}

// ------------------------------------------------------------------ pickup date validation (IST)

export interface PickupDateRule {
  /** Current instant; the business day is derived in Asia/Kolkata, never the staff browser zone (§40). */
  nowIso: string;
  /** Same-day pickup is refused at/after this IST hour (0–23). null disables the cutoff. */
  cutoffHourIST?: number | null;
  /** Furthest requestable day ahead (inclusive). Default 10. */
  maxAheadDays?: number;
}

export type PickupDateCheck =
  | { ok: true; sameDay: boolean }
  | { ok: false; reason: "invalid" | "past" | "cutoff" | "too_far" };

function istParts(nowIso: string): { date: string; hour: number } | null {
  const t = Date.parse(nowIso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const hourStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hour12: false,
  }).format(d);
  const hour = Number(hourStr.replace(/[^\d]/g, ""));
  return { date, hour: Number.isFinite(hour) ? hour % 24 : 0 };
}

function dayDiff(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Validate a requested courier pickup date against provider-agnostic rules in IST.
 * Past dates and (optionally) same-day-after-cutoff are refused here so the server
 * can reject a forged or stale date before any provider call (§41, §42, §107, §111).
 */
export function validatePickupDate(date: string, rule: PickupDateRule): PickupDateCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: "invalid" };
  // Reject impossible calendar dates (e.g. 2026-02-31) that pass the shape test.
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return { ok: false, reason: "invalid" };
  }

  const ist = istParts(rule.nowIso);
  if (!ist) return { ok: false, reason: "invalid" };

  const diff = dayDiff(ist.date, date);
  if (!Number.isFinite(diff)) return { ok: false, reason: "invalid" };
  if (diff < 0) return { ok: false, reason: "past" };

  const maxAhead = rule.maxAheadDays ?? 10;
  if (diff > maxAhead) return { ok: false, reason: "too_far" };

  const sameDay = diff === 0;
  if (sameDay && rule.cutoffHourIST != null && ist.hour >= rule.cutoffHourIST) {
    return { ok: false, reason: "cutoff" };
  }

  return { ok: true, sameDay };
}
