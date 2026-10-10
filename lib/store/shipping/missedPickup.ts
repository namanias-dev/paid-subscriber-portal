/**
 * A Delhivery pickup that was scheduled and never collected.
 *
 * "Not Picked" by itself is Delhivery's normal pre-pickup status, so it must not
 * cancel a shipment that is still waiting for today's courier. A pickup date that
 * is already over in Asia/Kolkata, with the carrier still showing a pre-pickup
 * status, means the parcel was not collected. Staff can then cancel that AWB and
 * book a new one. This module only decides. It does not call Delhivery.
 */

const PRE_PICKUP_ORDERS = new Set(["READY_FOR_PICKUP", "PICKUP_SCHEDULED"]);
const OPEN_SHIPMENT = new Set(["pending", "created", "manifested"]);
/** Unscheduled "Not Picked" this old is not a fresh booking waiting for a date. */
const UNSCHEDULED_STUCK_DAYS = 7;

export interface MissedPickupInput {
  provider: string | null;
  shipmentStatus: string | null;
  trackingStatus: string | null;
  pickupScheduledAt: string | null;
  createdAt: string | null;
  orderStatus: string;
  nowIso?: string;
}

function clean(raw: string | null | undefined): string {
  return (raw || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function istCalendarDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}

function dayDiff(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

/** Carrier wording that means the parcel is still at the academy, not on the network. */
export function carrierAwaitingPickup(rawStatus: string | null | undefined): boolean {
  const s = clean(rawStatus);
  if (!s || s.includes("cancel") || carrierHasPossession(rawStatus)) return false;
  if (s.includes("not picked")) return true;
  if (s.includes("manifest")) return true;
  if (s === "pending" || s.includes("ready to ship") || s.includes("awb assigned") || s.includes("shipment booked")) return true;
  return false;
}

/** In transit, delivered, or an actual pickup scan. "Not Picked" stays false. */
export function carrierHasPossession(rawStatus: string | null | undefined): boolean {
  const s = clean(rawStatus);
  if (!s || s.includes("not picked")) return false;
  if (/\bpicked up\b/.test(s) || s === "picked" || s.includes("pickup done") || s.includes("pickup complete") || s.includes("shipment picked")) return true;
  return (
    s.includes("in transit") ||
    s.includes("out for delivery") ||
    s.includes("delivered") ||
    s.includes("dispatched") ||
    s.includes("reached") ||
    s.includes("received at") ||
    s.includes("rto") ||
    s.includes("lost") ||
    s.includes("damag")
  );
}

/** The waybill itself is cancelled. A pickup-request cancellation is not this. */
export function carrierShipmentCancelled(rawStatus: string | null | undefined): boolean {
  const s = clean(rawStatus);
  if (!s || s.includes("pickup")) return false;
  return s.includes("cancel");
}

/**
 * Delhivery only. True when the scheduled pickup day is already over and the
 * carrier still has not collected the parcel, or when an unscheduled waybill has
 * said "Not Picked" for a week. Same-day "Not Picked" is still waiting.
 */
export function missedDelhiveryPickup(input: MissedPickupInput, nowIso = input.nowIso || new Date().toISOString()): boolean {
  if (input.provider !== "delhivery") return false;
  if (!PRE_PICKUP_ORDERS.has(input.orderStatus)) return false;
  if (!OPEN_SHIPMENT.has(clean(input.shipmentStatus))) return false;
  if (!carrierAwaitingPickup(input.trackingStatus)) return false;
  if (carrierHasPossession(input.trackingStatus)) return false;
  const today = istCalendarDate(nowIso);
  if (!today) return false;
  const scheduled = istCalendarDate(input.pickupScheduledAt);
  if (scheduled) return scheduled < today;
  if (!clean(input.trackingStatus).includes("not picked")) return false;
  const created = istCalendarDate(input.createdAt);
  if (!created) return false;
  return dayDiff(created, today) >= UNSCHEDULED_STUCK_DAYS;
}
