/**
 * Read-only operations summary for the admin Notes Orders list.
 * Stage, package and rate come from the same rules booking and tracking use.
 */
import { stageProgress, type StageProgress } from "./opsBoard";
import { resolveBookingPackage } from "./shipping/manualBook";
import type { PackageLine } from "./shipping/autoFulfill";
import { isCapturedNotesOrder } from "./customerGroups";
import type { OrderOps, PackageDisplay, ShippingRateStats } from "./orderOpsDisplay";

export type { OrderOps, PackageDisplay, PackageDisplaySource, ShippingRateStats } from "./orderOpsDisplay";
export { formatPackageDims, formatPackageWeight, PACKAGE_SOURCE_LABEL } from "./orderOpsDisplay";

export interface ShipmentRowLike {
  status: string | null;
  awb: string | null;
  weight_grams?: number | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  provider_payload?: unknown;
  created_at?: string | null;
}

const INACTIVE_SHIPMENT = new Set(["cancelled", "failed", "expired", "superseded"]);

function payloadOf(row: { provider_payload?: unknown }): Record<string, unknown> {
  return row.provider_payload && typeof row.provider_payload === "object" ? (row.provider_payload as Record<string, unknown>) : {};
}

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Saved courier rate for a booked shipment. Never the customer's shipping charge. */
export function savedCourierRatePaise(payload: unknown): number | null {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return positiveInt(p.booked_rate_paise) ?? positiveInt(p.rate_paise);
}

/** Newest live shipment with an AWB. Cancelled, failed and do-not-use rows stay history. */
export function liveShipment<T extends ShipmentRowLike>(rowsNewestFirst: T[]): T | null {
  return (
    rowsNewestFirst.find((row) => {
      if (!row.awb) return false;
      if (INACTIVE_SHIPMENT.has(String(row.status || "").toLowerCase())) return false;
      return payloadOf(row).do_not_use !== true;
    }) || null
  );
}

function awaitingCityConfirm(row: ShipmentRowLike): boolean {
  const p = payloadOf(row);
  return p.city_confirm_required === true && p.destination_accepted !== true;
}

function hasDims(row: ShipmentRowLike): boolean {
  return Boolean(row.weight_grams && row.length_mm && row.width_mm && row.height_mm);
}

/** Same line construction as the dispatch route: product profile first, item weight snapshot as fallback. */
export function packageLinesFrom(
  items: Array<{ qty: number | null; product_id?: string | null; weight_grams_snapshot?: number | null }>,
  products: Map<string, { weight_grams: number | null; length_mm: number | null; width_mm: number | null; height_mm: number | null }>,
): PackageLine[] {
  return items.map((item) => {
    const product = item.product_id ? products.get(item.product_id) || null : null;
    return {
      qty: Number(item.qty) || 1,
      weightGrams: product?.weight_grams || item.weight_grams_snapshot || null,
      lengthMm: product?.length_mm || null,
      widthMm: product?.width_mm || null,
      heightMm: product?.height_mm || null,
    };
  });
}

/**
 * Booked shipment snapshot, else exactly what booking would use
 * (saved package, then a single-product × 1 profile), else nothing.
 */
export function resolvePackageDisplay(input: { rows: ShipmentRowLike[]; lines: PackageLine[] }): PackageDisplay | null {
  const live = liveShipment(input.rows);
  if (live && hasDims(live)) {
    return {
      weight_grams: Number(live.weight_grams),
      length_cm: Number(live.length_mm) / 10,
      width_cm: Number(live.width_mm) / 10,
      height_cm: Number(live.height_mm) / 10,
      source: "BOOKED_SHIPMENT",
    };
  }
  const saved = input.rows.find(hasDims) || null;
  const pack = resolveBookingPackage({
    override: saved
      ? { weightGrams: saved.weight_grams ?? null, lengthMm: saved.length_mm ?? null, widthMm: saved.width_mm ?? null, heightMm: saved.height_mm ?? null }
      : null,
    lines: input.lines,
  });
  if (!pack.ok) return null;
  return {
    weight_grams: pack.weightGrams,
    length_cm: pack.lengthCm,
    width_cm: pack.widthCm,
    height_cm: pack.heightCm,
    source: pack.source === "STAFF_OVERRIDE" ? "ORDER_PACKAGE" : "PRODUCT_PROFILE",
  };
}

/** IST wall time. Converts an ISO instant to the Asia/Kolkata calendar date. */
function istDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Provider pickup slot. A date with a slot time returns "YYYY-MM-DD HH:MM" (IST wall time);
 * a date alone stays a date. Shipment created/updated times are never used.
 */
export function pickupWhen(input: {
  pickup_date?: string | null;
  pickup_reattempt_date?: string | null;
  pickup_time?: string | null;
  pickup_scheduled_at?: string | null;
}): string | null {
  const date = String(input.pickup_reattempt_date || input.pickup_date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const time = String(input.pickup_time || "").trim().match(/^(\d{1,2}):(\d{2})/);
    if (time && !input.pickup_reattempt_date) return `${date} ${time[1].padStart(2, "0")}:${time[2]}`;
    return date;
  }
  return input.pickup_scheduled_at ? istDate(input.pickup_scheduled_at) : null;
}

const JUNK_ACTIVITY = new Set(["na", "n/a", "null", "undefined", "none", "-", "--", "unknown"]);
const PRE_POSSESSION_TEXT = /pickup|pick up|manifest|data received|shipment booked|awb assigned|label generated/i;
const POSSESSED_STAGES = new Set(["shipped", "transit", "delivery", "delivered"]);

/**
 * Latest stored provider event, only when it is short, readable and not stale for the
 * current stage. Text that only repeats the stage keeps its time and drops the words.
 */
export function latestTracking(
  activity: string | null | undefined,
  eventAt: string | null | undefined,
  stage: StageProgress | null,
): { text: string | null; at: string | null } {
  const none = { text: null, at: null };
  const text = String(activity || "").replace(/\s+/g, " ").trim();
  if (text.length < 3 || text.length > 80) return none;
  if (JUNK_ACTIVITY.has(text.toLowerCase())) return none;
  if (!/[a-z]/i.test(text)) return none;
  if (/^[A-Z0-9_]+$/.test(text) && text.includes("_")) return none;
  const at = eventAt ? String(eventAt) : null;
  if (!stage) return { text, at };
  if (stage.key === "delivered") return none;
  if (POSSESSED_STAGES.has(stage.key) && PRE_POSSESSION_TEXT.test(text)) return none;
  if (text.toLowerCase() === stage.label.toLowerCase()) return { text: null, at };
  return { text, at };
}

const ISSUE_COPY: Array<[string, string]> = [
  ["Courier city needs confirmation", "Courier city confirmation"],
  ["Address mismatch", "Shipment needs attention"],
  ["Pickup wasn't completed", "Pickup needs attention"],
  ["Courier exception", "Delivery exception"],
  ["Return action required", "Return needs attention"],
  ["Refund pending", "Refund pending"],
  ["Customer issue open", "Customer issue open"],
  ["Tracking stale", "Tracking needs attention"],
];

/** Staff-facing issue line. Packed without a courier is normal work, not an issue. */
export function opsIssue(input: { reasons: string[]; packed: boolean; awb: string | null; package: PackageDisplay | null }): string | null {
  for (const [reason, copy] of ISSUE_COPY) {
    if (input.reasons.includes(reason)) return copy;
  }
  if (input.packed && !input.awb && !input.package) return "Package required";
  return null;
}

export interface OrderOpsShipment {
  courier: string | null;
  awb: string | null;
  provider: string | null;
  status: string | null;
  pickup_scheduled_at: string | null;
  pickup_date: string | null;
  pickup_time: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  tracking_activity: string | null;
  tracking_event_at: string | null;
  rate_paise: number | null;
}

const PACKED = new Set(["PACKED", "READY_FOR_PICKUP"]);

export function buildOrderOps(input: {
  status: string;
  address: { city?: unknown; state?: unknown } | null;
  ship: OrderOpsShipment | null;
  cityConfirm: boolean;
  reasons: string[];
  package: PackageDisplay | null;
  orderDeliveredAt?: string | null;
}): OrderOps {
  const stage = stageProgress(input.status);
  const ship = input.ship;
  const awb = ship?.awb || null;
  const booked = Boolean(awb);
  const packed = PACKED.has(input.status);
  const delivered = input.status === "DELIVERED";
  const possessed = Boolean(stage && POSSESSED_STAGES.has(stage.key));
  const latest = booked ? latestTracking(ship?.tracking_activity, ship?.tracking_event_at, stage) : { text: null, at: null };
  return {
    stage,
    city: typeof input.address?.city === "string" && input.address.city.trim() ? input.address.city.trim() : null,
    state: typeof input.address?.state === "string" && input.address.state.trim() ? input.address.state.trim() : null,
    courier: booked ? ship?.courier || null : null,
    provider: booked ? ship?.provider || null : null,
    rate_paise: booked && ship?.rate_paise && ship.rate_paise > 0 ? ship.rate_paise : null,
    courier_not_selected: packed && !booked && !input.cityConfirm,
    pickup_at: booked && !possessed ? pickupWhen({ pickup_date: ship?.pickup_date, pickup_time: ship?.pickup_time, pickup_scheduled_at: ship?.pickup_scheduled_at }) : null,
    picked_up_at: booked && possessed ? ship?.picked_up_at || null : null,
    delivered_at: delivered ? ship?.delivered_at || input.orderDeliveredAt || null : null,
    latest_text: latest.text,
    latest_at: latest.at,
    package: input.package,
    issue: opsIssue({ reasons: input.reasons, packed, awb, package: input.package }),
  };
}

const RATE_STAGES = new Set(["PICKUP_SCHEDULED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"]);

/**
 * One current shipment per captured, non-QA order from pickup onward
 * (or packed with a live booking). Unknown rates are counted, not averaged.
 */
export function shippingRateStats(
  orders: Array<{ id: string; status: string; paid_at: string | null; qa?: boolean }>,
  shipmentsByOrder: Map<string, ShipmentRowLike[]>,
): ShippingRateStats {
  const rates: number[] = [];
  let unknown = 0;
  for (const order of orders) {
    if (order.qa || !isCapturedNotesOrder(order)) continue;
    if (!RATE_STAGES.has(order.status) && !PACKED.has(order.status)) continue;
    const live = liveShipment(shipmentsByOrder.get(order.id) || []);
    if (!live || awaitingCityConfirm(live)) continue;
    const rate = savedCourierRatePaise(live.provider_payload);
    if (rate == null) unknown += 1;
    else rates.push(rate);
  }
  if (!rates.length) return { count: 0, avg_paise: null, min_paise: null, max_paise: null, unknown };
  const sum = rates.reduce((a, b) => a + b, 0);
  return {
    count: rates.length,
    avg_paise: Math.round(sum / rates.length),
    min_paise: Math.min(...rates),
    max_paise: Math.max(...rates),
    unknown,
  };
}
