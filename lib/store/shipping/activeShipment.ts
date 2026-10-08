/**
 * The one definition of "this order already has a live shipment / AWB / label".
 *
 * A cancelled, failed, superseded or void row is history. It must not block a
 * fresh booking, and it must not be offered as the current Download Label.
 * Callers pass rows newest-first when more than one live row could exist.
 */

export const INACTIVE_SHIPMENT_STATUSES = new Set([
  "cancelled",
  "canceled",
  "failed",
  "expired",
  "superseded",
  "void",
]);

export function isInactiveShipmentStatus(status: string | null | undefined): boolean {
  return INACTIVE_SHIPMENT_STATUSES.has(String(status || "").trim().toLowerCase());
}

export interface ActiveShipmentRow {
  id?: string;
  status: string | null;
  awb: string | null;
}

/** Newest live AWB. Cancelled / superseded / void rows are skipped. */
export function selectActiveShipment<T extends ActiveShipmentRow>(rowsNewestFirst: T[]): T | null {
  return rowsNewestFirst.find((row) => Boolean(row.awb) && !isInactiveShipmentStatus(row.status)) || null;
}

/**
 * True only when this shipment id is the order's current live AWB.
 * A missing live row means the event may still retire the order (the row
 * itself was just marked terminal). A different live id means the event
 * belongs to history and must not move the order.
 */
export function shipmentEventMayMoveOrder(shipmentId: string, rows: ActiveShipmentRow[]): boolean {
  const active = selectActiveShipment(rows);
  if (!active?.id) return true;
  return active.id === shipmentId;
}

export interface CurrentLabelShipment extends ActiveShipmentRow {
  label_url?: string | null;
  label_r2_key?: string | null;
  provider_payload?: unknown;
}

function payloadLabel(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const url = (payload as { label_url?: unknown }).label_url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

/**
 * Current label comes only from the active shipment. A cancelled shipment's
 * label is historical and is never returned here.
 */
export function getCurrentShipmentLabel<T extends CurrentLabelShipment>(
  order: { shipments?: T[] | null },
): { shipment: T; labelUrl: string | null } | null {
  const current = selectActiveShipment(order.shipments || []);
  if (!current) return null;
  const labelUrl = current.label_url || payloadLabel(current.provider_payload) || current.label_r2_key || null;
  return { shipment: current, labelUrl };
}

/** Generate / retry never allocates another shipment or AWB. */
export function nextLabelAction(input: {
  activeAwb: string | null;
  hasStoredLabel: boolean;
  lastAttemptFailed: boolean;
}): { action: "download" | "generate" | "retry" | "none"; createsShipment: false; createsAwb: false } {
  const frozen = { createsShipment: false as const, createsAwb: false as const };
  if (!input.activeAwb) return { action: "none", ...frozen };
  if (input.lastAttemptFailed) return { action: "retry", ...frozen };
  if (input.hasStoredLabel) return { action: "download", ...frozen };
  return { action: "generate", ...frozen };
}
