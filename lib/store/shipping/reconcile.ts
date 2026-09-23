/**
 * Decide which open shipments need a tracking read.
 * Webhooks are the source of a scan. This classifier only marks a gap.
 * Delivered, cancelled, lost, and damaged shipments are never polled.
 */

const TERMINAL = new Set(["delivered", "cancelled", "lost", "damaged"]);
const WAITING_PICKUP = new Set(["pending", "created", "manifested"]);
const HOUR = 60 * 60 * 1000;

export const TRACKING_STALE_MS = 12 * HOUR;
export const PICKUP_OVERDUE_MS = 24 * HOUR;
export const FIRST_SCAN_GRACE_MS = 12 * HOUR;
export const WEBHOOK_GAP_MS = 6 * HOUR;

const POLL_REASONS = new Set(["pickup_overdue", "no_first_scan", "stale", "webhook_gap"]);

export interface TrackingSnapshot {
  status: string;
  provider: string;
  awb: string | null;
  createdAt: string;
  now: string;
  pickupScheduledAt?: string | null;
  pickedUpAt?: string | null;
  lastSyncedAt?: string | null;
  expectedDeliveryDate?: string | null;
}

function ageMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return now - t;
}

/** Attention labels only. A label does not call a courier. */
export function classifyTrackingGap(input: TrackingSnapshot): string[] {
  if (TERMINAL.has(input.status)) return [];
  const now = Date.parse(input.now);
  const createdAge = ageMs(input.createdAt, now);
  const syncAge = ageMs(input.lastSyncedAt, now);
  const pickupAge = ageMs(input.pickupScheduledAt, now);
  const hasAwb = Boolean(input.awb && input.awb.trim());
  const reasons: string[] = [];

  if (input.status === "delivery_failed") reasons.push("ndr");
  if (input.status === "rto") reasons.push("rto");

  const waiting = WAITING_PICKUP.has(input.status);
  if (waiting && !input.pickedUpAt && pickupAge !== null && pickupAge > PICKUP_OVERDUE_MS) {
    reasons.push("pickup_overdue");
  }
  if (hasAwb && waiting && !input.pickedUpAt && syncAge === null && createdAge !== null && createdAge > FIRST_SCAN_GRACE_MS) {
    reasons.push("no_first_scan");
  }
  if (hasAwb && syncAge === null && createdAge !== null && createdAge > WEBHOOK_GAP_MS) {
    reasons.push("webhook_gap");
  }
  if (hasAwb && syncAge !== null && syncAge > TRACKING_STALE_MS) {
    reasons.push("stale");
  }
  if (input.expectedDeliveryDate && input.status !== "delivered") {
    const day = input.expectedDeliveryDate.slice(0, 10);
    const today = input.now.slice(0, 10);
    if (day < today) reasons.push("eta_exceeded");
  }
  return reasons;
}

/**
 * Poll only an API shipment that already has an AWB and has gone quiet.
 * A recent webhook or poll suppresses another read. NDR, RTO, and a missed
 * ETA are visible without a poll while scans are still arriving.
 */
export function shouldPollShipment(input: TrackingSnapshot): boolean {
  if (TERMINAL.has(input.status)) return false;
  if (input.provider !== "shiprocket" && input.provider !== "delhivery") return false;
  if (!input.awb || !input.awb.trim()) return false;
  const syncAge = ageMs(input.lastSyncedAt, Date.parse(input.now));
  if (syncAge !== null && syncAge <= TRACKING_STALE_MS) return false;
  return classifyTrackingGap(input).some((reason) => POLL_REASONS.has(reason));
}
