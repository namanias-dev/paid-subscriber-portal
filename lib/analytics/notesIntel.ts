/**
 * Notes analytics intelligence. Pure aggregation, no database.
 *
 * Three time semantics, labelled separately in the UI:
 *  A. Sales cohort — orders captured (paid) inside the selected range. Subjects,
 *     states, cities and shipping economics all use this cohort, so orders,
 *     revenue, geography and shipping stay consistent with the KPI row.
 *  B. Fulfillment activity — picked up / shipped / delivered events whose own
 *     timestamp falls inside the range, whatever day the order was paid.
 *  C. Fulfillment now — current order status, independent of the range.
 *
 * Shipping rates are the booked courier rate saved at booking
 * (`savedCourierRatePaise`) on the one shipment `rateShipmentFor` picks, the
 * same rule the Notes Orders tile uses. It is never the customer's checkout
 * shipping charge and never a provider invoice. Missing rates are counted as
 * coverage gaps, never as ₹0.
 */
import { isQaNotesOrder, notesBusinessOrders, type NotesOrderFact, type StoredNotesAttribution } from "./notesCommerce";
import { bucketKeys, grainFor, normalizeCity, pointAxis, pointKey, pointLabel, type NotesDestination } from "./notesVisuals";
import { normalizeIndiaState, UNKNOWN_STATE_CODE } from "./indiaStates";
import { orderIndexLabel } from "@/lib/store/adminConsole";
import { isAcademyPickup } from "@/lib/store/fulfillment";
import { liveShipment, packageLinesFrom, rateShipmentFor, resolvePackageDisplay, savedCourierRatePaise, type ShipmentRowLike } from "@/lib/store/orderOps";

// ------------------------------------------------------------------ inputs

export interface IntelOrder extends NotesOrderFact {
  order_no?: string | null;
  shipping_paise?: number | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  /** Academy Pickup collection timestamps. */
  ready_for_collection_at?: string | null;
  collected_at?: string | null;
}

export interface IntelItem {
  order_id: string;
  product_id?: string | null;
  name_snapshot: string;
  qty?: number | null;
  line_total_paise: number;
  weight_grams_snapshot?: number | null;
}

export interface IntelProduct {
  id: string;
  name: string;
  short_name?: string | null;
  subject?: string | null;
  kind?: string | null;
  selling_price_paise?: number | null;
  weight_grams?: number | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
}

export interface IntelBundleItem {
  bundle_id: string;
  component_id: string;
  qty?: number | null;
}

export interface IntelShipment extends ShipmentRowLike {
  order_id: string;
  provider?: string | null;
  courier_name?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
}

// ----------------------------------------------------------------- outputs

export interface SubjectRow {
  key: string;
  label: string;
  orders: number;
  units: number;
  netRevenuePaise: number;
  avgNetPerOrderPaise: number | null;
  unitSharePct: number | null;
  revenueSharePct: number | null;
  /** Units per chart bucket. Same buckets as Sales over time. */
  spark: number[];
}

export interface FulfillmentPoint {
  key: string;
  label: string;
  axis: string;
  pickedUp: number;
  shipped: number;
  delivered: number;
}

export interface RateStats {
  count: number;
  avgPaise: number | null;
  medianPaise: number | null;
  minPaise: number | null;
  maxPaise: number | null;
}

export interface StateRow extends RateStats {
  code: string;
  name: string;
  orders: number;
  units: number;
  revenuePaise: number;
  aovPaise: number | null;
  subjectUnits: Array<{ label: string; units: number }>;
  topCourier: string | null;
  anomalies: number;
  avgWeightGrams: number | null;
  /** Booked shipments for this state's cohort orders, with or without a saved rate. */
  shipments: number;
}

export interface CityRow extends RateStats {
  key: string;
  city: string;
  state: string;
  stateCode: string;
  orders: number;
  units: number;
  revenuePaise: number;
  sharePct: number | null;
  topCourier: string | null;
}

export interface CourierRow extends RateStats {
  key: string;
  courier: string;
  provider: string;
  shipments: number;
  pickedUp: number;
  delivered: number;
  sharePct: number | null;
}

export interface ProviderRow extends RateStats {
  provider: string;
  shipments: number;
}

export interface RateBucket {
  id: string;
  label: string;
  count: number;
}

export interface RateAnomaly {
  orderId: string;
  orderNo: string;
  /** "#1055" style label staff use on the Orders page. */
  orderLabel: string;
  city: string;
  state: string;
  weightGrams: number | null;
  weightBand: string;
  courier: string;
  provider: string;
  ratePaise: number;
  peerMedianPaise: number;
  peerLowPaise: number;
  peerHighPaise: number;
  peerCount: number;
  differencePaise: number;
  differencePct: number;
  comparison: "state" | "national";
  burdenPct: number | null;
  reason: string;
}

export interface ShippingIntel extends RateStats {
  /** Cohort orders with a canonical booked shipment. Coverage denominator. */
  booked: number;
  /** Paid DELIVERY cohort orders. Context for coverage; Academy Pickup never ships. */
  paidOrders: number;
  atOrUnder100: number;
  over100: number;
  atOrUnder100Pct: number | null;
  avgBurdenPct: number | null;
  distribution: RateBucket[];
  byState: StateRow[];
  byCity: CityRow[];
  byCourier: CourierRow[];
  byProvider: ProviderRow[];
  duplicateAwbsSkipped: number;
}

/** One fulfilment method's share of the paid cohort. Sums reconcile to `cohort`. */
export interface MethodRow {
  orders: number;
  units: number;
  revenuePaise: number;
  aovPaise: number | null;
  sharePct: number | null;
}

export interface PickupOps {
  /** Pickup orders waiting at the academy right now (any paid date). */
  readyNow: number;
  waitingOver1d: number;
  waitingOver3d: number;
  oldestReadyMs: number | null;
  collectedInRange: number;
  readyToday: number;
  collectedToday: number;
  /** Median paid → ready for orders that became ready in range; null when none. */
  medianPaidToReadyMs: number | null;
  paidToReadySample: number;
  /** Median ready → collected for orders collected in range (open orders excluded). */
  medianReadyToCollectedMs: number | null;
  readyToCollectedSample: number;
}

export interface NotesIntel {
  grain: "hour" | "day";
  methods: { delivery: MethodRow; pickup: MethodRow };
  pickupOps: PickupOps;
  cohort: { orders: number; units: number; revenuePaise: number; merchandisePaise: number };
  subjects: SubjectRow[];
  fulfillment: FulfillmentPoint[];
  fulfillmentTotals: { pickedUp: number; shipped: number; delivered: number };
  today: { pickedUp: number; shipped: number; delivered: number };
  now: { packed: number; pickup: number; inTransit: number; outForDelivery: number };
  states: StateRow[];
  cities: CityRow[];
  shipping: ShippingIntel;
  anomalies: RateAnomaly[];
  anomalyRule: string;
}

// ------------------------------------------------------------------ helpers

/**
 * Split an integer amount across weights with the largest-remainder method.
 * Result sums exactly to `total`; ties go to the earlier index. Zero weights
 * receive nothing unless every weight is zero, then the split is equal.
 */
export function allocateByWeight(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const sign = total < 0 ? -1 : 1;
  const amount = Math.abs(Math.round(total));
  const safe = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const sum = safe.reduce((a, b) => a + b, 0);
  const basis = sum > 0 ? safe : safe.map(() => 1);
  const basisSum = sum > 0 ? sum : basis.length;
  const raw = basis.map((weight) => (amount * weight) / basisSum);
  const floors = raw.map((value) => Math.floor(value));
  let left = amount - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, rem: value - Math.floor(value) }))
    .sort((a, b) => b.rem - a.rem || a.index - b.index);
  for (const slot of order) {
    if (left <= 0) break;
    if (basis[slot.index] <= 0) continue;
    floors[slot.index] += 1;
    left -= 1;
  }
  return floors.map((value) => value * sign);
}

export function medianOf(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

export function rateStats(rates: number[]): RateStats {
  if (!rates.length) return { count: 0, avgPaise: null, medianPaise: null, minPaise: null, maxPaise: null };
  const sorted = [...rates].sort((a, b) => a - b);
  return {
    count: sorted.length,
    avgPaise: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    medianPaise: medianOf(sorted),
    minPaise: sorted[0],
    maxPaise: sorted[sorted.length - 1],
  };
}

function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function qtyOf(item: { qty?: number | null }): number {
  return item.qty == null || item.qty < 1 ? 1 : Math.round(item.qty);
}

function topKey(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [name, n] of counts) {
    if (n > bestN || (n === bestN && best != null && name.localeCompare(best) < 0)) {
      best = name;
      bestN = n;
    }
  }
  return best;
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

const PROVIDER_LABEL: Record<string, string> = {
  shiprocket: "Shiprocket",
  delhivery: "Delhivery Direct",
  manual: "Manual",
};

export function providerLabel(provider: string | null | undefined): string {
  const key = String(provider || "").trim().toLowerCase();
  if (!key) return "Unknown";
  return PROVIDER_LABEL[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

/** Courier service as booked. "Blue Dart Air" and "Blue Dart Surface" stay apart. */
export function courierLabel(name: string | null | undefined): string {
  const clean = String(name || "").replace(/\s+/g, " ").trim();
  return clean || "Unknown courier";
}

// ------------------------------------------------------------- weight bands

export const WEIGHT_BANDS: Array<{ id: string; label: string; max: number }> = [
  { id: "w600", label: "≤600 g", max: 600 },
  { id: "w1100", label: "601–1100 g", max: 1100 },
  { id: "w2000", label: "1101–2000 g", max: 2000 },
  { id: "wmax", label: ">2000 g", max: Number.POSITIVE_INFINITY },
];

export function weightBand(grams: number | null | undefined): { id: string; label: string } | null {
  if (grams == null || !Number.isFinite(grams) || grams <= 0) return null;
  const band = WEIGHT_BANDS.find((row) => grams <= row.max) || WEIGHT_BANDS[WEIGHT_BANDS.length - 1];
  return { id: band.id, label: band.label };
}

// -------------------------------------------------------------- rate buckets

export const RATE_BUCKETS: Array<{ id: string; label: string; min: number; max: number }> = [
  { id: "lt60", label: "< ₹60", min: 0, max: 6000 },
  { id: "60", label: "₹60–79", min: 6000, max: 8000 },
  { id: "80", label: "₹80–99", min: 8000, max: 10000 },
  { id: "100", label: "₹100–149", min: 10000, max: 15000 },
  { id: "150", label: "₹150–199", min: 15000, max: 20000 },
  { id: "200", label: "₹200+", min: 20000, max: Number.POSITIVE_INFINITY },
];

export function rateDistribution(rates: number[]): RateBucket[] {
  return RATE_BUCKETS.map((bucket) => ({
    id: bucket.id,
    label: bucket.label,
    count: rates.filter((rate) => rate >= bucket.min && rate < bucket.max).length,
  }));
}

// ----------------------------------------------------------------- anomalies

export const ANOMALY_MIN_PEERS = 3;
export const ANOMALY_RATIO = 1.5;
export const ANOMALY_MIN_EXCESS_PAISE = 4000;

export const ANOMALY_RULE =
  "Flag when the booked rate is at least 1.5× the peer median and at least ₹40 above it. " +
  "Peers are other booked shipments to the same state in the same weight band (≤600 g, 601–1100 g, 1101–2000 g, >2000 g), " +
  "needing 3 or more. With fewer than 3, peers are same-weight shipments nationally. Unknown weight or rate is never flagged.";

export interface RatedShipment {
  orderId: string;
  stateCode: string;
  band: string | null;
  ratePaise: number;
}

export interface PeerVerdict {
  flagged: boolean;
  comparison: "state" | "national" | null;
  peers: number[];
  medianPaise: number | null;
}

/** Transparent median rule. The shipment itself is never its own peer. */
export function judgeRate(target: RatedShipment, pool: RatedShipment[]): PeerVerdict {
  if (!target.band) return { flagged: false, comparison: null, peers: [], medianPaise: null };
  const others = pool.filter((row) => row.orderId !== target.orderId && row.band === target.band);
  let comparison: "state" | "national" | null = null;
  let peers: number[] = [];
  if (target.stateCode !== UNKNOWN_STATE_CODE) {
    const local = others.filter((row) => row.stateCode === target.stateCode).map((row) => row.ratePaise);
    if (local.length >= ANOMALY_MIN_PEERS) {
      comparison = "state";
      peers = local;
    }
  }
  if (!comparison) {
    const national = others.map((row) => row.ratePaise);
    if (national.length >= ANOMALY_MIN_PEERS) {
      comparison = "national";
      peers = national;
    }
  }
  if (!comparison) return { flagged: false, comparison: null, peers: [], medianPaise: null };
  const sorted = [...peers].sort((a, b) => a - b);
  const median = medianOf(sorted) as number;
  const flagged = target.ratePaise >= median * ANOMALY_RATIO && target.ratePaise - median >= ANOMALY_MIN_EXCESS_PAISE;
  return { flagged, comparison, peers: sorted, medianPaise: median };
}

// ------------------------------------------------------- subject allocation

export interface SubjectLine {
  orderId: string;
  subjectKey: string;
  subjectLabel: string;
  units: number;
  netPaise: number;
}

function subjectOfProduct(product: IntelProduct | null | undefined, fallbackName: string): { key: string; label: string } {
  const raw = String(product?.subject || "").replace(/\s+/g, " ").trim();
  const label = raw || String(product?.short_name || "").trim() || String(product?.name || "").trim() || fallbackName.trim() || "Notes";
  return { key: label.toLowerCase(), label };
}

/**
 * Net product revenue per subject for one captured order, in integer paise.
 *
 * Line totals are already net of line-level offer discounts. Whatever remains
 * between the order's merchandise value (total − customer shipping) and the
 * sum of line totals — an order-level discount, tax-exclusive tax or rounding —
 * is allocated across lines by their line value with the largest-remainder
 * method. Customer shipping is never allocated to a subject.
 *
 * Bundle lines are split into their component subjects by component selling
 * price × quantity, again with integer allocation.
 */
export function subjectLinesForOrder(
  order: Pick<IntelOrder, "id" | "total_paise" | "shipping_paise">,
  items: IntelItem[],
  products: Map<string, IntelProduct>,
  bundles: Map<string, IntelBundleItem[]>,
): SubjectLine[] {
  const merchandise = Math.max(0, Math.round((order.total_paise || 0) - (order.shipping_paise || 0)));
  if (!items.length) {
    return merchandise ? [{ orderId: order.id, subjectKey: "unassigned", subjectLabel: "Unassigned", units: 0, netPaise: merchandise }] : [];
  }
  const lineValues = items.map((item) => Math.max(0, Math.round(item.line_total_paise || 0)));
  const lineSum = lineValues.reduce((a, b) => a + b, 0);
  const residual = allocateByWeight(merchandise - lineSum, lineValues);
  const out: SubjectLine[] = [];
  items.forEach((item, index) => {
    const net = lineValues[index] + residual[index];
    const qty = qtyOf(item);
    const product = item.product_id ? products.get(item.product_id) : undefined;
    const parts = product?.kind === "bundle" ? bundles.get(product.id) || [] : [];
    if (parts.length) {
      const weights = parts.map((part) => {
        const component = products.get(part.component_id);
        return Math.max(0, Number(component?.selling_price_paise) || 0) * Math.max(1, Number(part.qty) || 1);
      });
      const split = allocateByWeight(net, weights);
      parts.forEach((part, partIndex) => {
        const subject = subjectOfProduct(products.get(part.component_id), item.name_snapshot);
        out.push({
          orderId: order.id,
          subjectKey: subject.key,
          subjectLabel: subject.label,
          units: qty * Math.max(1, Number(part.qty) || 1),
          netPaise: split[partIndex],
        });
      });
      return;
    }
    const subject = subjectOfProduct(product, item.name_snapshot);
    out.push({ orderId: order.id, subjectKey: subject.key, subjectLabel: subject.label, units: qty, netPaise: net });
  });
  return out;
}

// ------------------------------------------------------------------- build

const PACKED = new Set(["PACKED", "READY_FOR_PICKUP"]);
const IN_TRANSIT = new Set(["PICKED_UP", "IN_TRANSIT"]);
const POSSESSED_SHIPMENT = new Set(["picked_up", "in_transit", "out_for_delivery", "delivered", "delivery_failed", "rto"]);

function inRange(iso: string | null | undefined, start: Date, end: Date, now: Date): boolean {
  if (!iso) return false;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return false;
  return at >= start && at < end && at <= now;
}

function newestFirst<T extends { created_at?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

function earliest(values: Array<string | null | undefined>): string | null {
  const times = values.filter((value): value is string => Boolean(value) && !Number.isNaN(Date.parse(String(value))));
  if (!times.length) return null;
  return times.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

function qaOf(order: IntelOrder): boolean {
  return isQaNotesOrder({
    attribution_source: order.attribution_source ?? null,
    attribution_json: (order.attribution_json || null) as StoredNotesAttribution | null,
    promo_code: order.promo_code ?? null,
  });
}

interface ShipFact {
  order: IntelOrder;
  stateCode: string;
  stateName: string;
  cityKey: string;
  city: string;
  courier: string;
  provider: string;
  ratePaise: number | null;
  weightGrams: number | null;
  band: { id: string; label: string } | null;
  pickedUp: boolean;
  delivered: boolean;
}

export function buildNotesIntel(input: {
  /** Every loaded order with a paid_at, any date. QA rows are excluded here. */
  orders: IntelOrder[];
  items: IntelItem[];
  products: IntelProduct[];
  bundleItems?: IntelBundleItem[];
  shipments: IntelShipment[];
  destinations: NotesDestination[];
  start: Date;
  end: Date;
  todayStart: Date;
  todayEnd: Date;
  now: Date;
}): NotesIntel {
  const { start, end, now } = input;
  const grain = grainFor(start, end);
  const keys = bucketKeys(start, end, grain, now);
  const keyIndex = new Map(keys.map((key, index) => [key, index]));

  const products = new Map(input.products.map((product) => [product.id, product]));
  const bundles = new Map<string, IntelBundleItem[]>();
  for (const row of input.bundleItems || []) {
    const list = bundles.get(row.bundle_id) || [];
    list.push(row);
    bundles.set(row.bundle_id, list);
  }
  const itemsByOrder = new Map<string, IntelItem[]>();
  for (const item of input.items) {
    const list = itemsByOrder.get(item.order_id) || [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }
  const shipsByOrder = new Map<string, IntelShipment[]>();
  for (const ship of input.shipments) {
    const list = shipsByOrder.get(ship.order_id) || [];
    list.push(ship);
    shipsByOrder.set(ship.order_id, list);
  }
  for (const [id, rows] of shipsByOrder) shipsByOrder.set(id, newestFirst(rows));
  const destByOrder = new Map(input.destinations.map((row) => [row.orderId, row]));
  const profiles = new Map(input.products.map((product) => [product.id, {
    weight_grams: product.weight_grams ?? null,
    length_mm: product.length_mm ?? null,
    width_mm: product.width_mm ?? null,
    height_mm: product.height_mm ?? null,
  }]));

  const nonQa = input.orders.filter((order) => order.paid_at && !qaOf(order));
  // Cohort = exactly the KPI row's paid orders: captured, non-QA, paid in range.
  const cohort = notesBusinessOrders(nonQa).filter((order) => inRange(order.paid_at, start, end, now)) as IntelOrder[];

  // ---- current snapshot (C). Same status buckets as the Notes Orders tiles.
  const nowCounts = { packed: 0, pickup: 0, inTransit: 0, outForDelivery: 0 };
  for (const order of input.orders) {
    if (PACKED.has(order.status)) nowCounts.packed += 1;
    else if (order.status === "PICKUP_SCHEDULED") nowCounts.pickup += 1;
    else if (IN_TRANSIT.has(order.status)) nowCounts.inTransit += 1;
    else if (order.status === "OUT_FOR_DELIVERY") nowCounts.outForDelivery += 1;
  }

  // ---- fulfillment events (B). One event per order per kind, own timestamp.
  const fulfillment: FulfillmentPoint[] = keys.map((key) => ({ key, label: pointLabel(key, grain), axis: pointAxis(key, grain), pickedUp: 0, shipped: 0, delivered: 0 }));
  const today = { pickedUp: 0, shipped: 0, delivered: 0 };
  const events = (order: IntelOrder) => {
    const rows = shipsByOrder.get(order.id) || [];
    const usable = rows.filter((row) => {
      const payload = row.provider_payload && typeof row.provider_payload === "object" ? (row.provider_payload as Record<string, unknown>) : {};
      return payload.do_not_use !== true;
    });
    const canonical = liveShipment(rows);
    return {
      pickedUp: earliest(usable.map((row) => row.picked_up_at)),
      shipped: order.shipped_at || null,
      delivered: order.delivered_at || canonical?.delivered_at || null,
    };
  };
  for (const order of nonQa) {
    const at = events(order);
    (["pickedUp", "shipped", "delivered"] as const).forEach((kind) => {
      const iso = at[kind];
      if (!iso) return;
      if (inRange(iso, start, end, now)) {
        const index = keyIndex.get(pointKey(new Date(iso), grain));
        if (index != null) fulfillment[index][kind] += 1;
      }
      if (inRange(iso, input.todayStart, input.todayEnd, now)) today[kind] += 1;
    });
  }
  const fulfillmentTotals = fulfillment.reduce(
    (sum, point) => ({ pickedUp: sum.pickedUp + point.pickedUp, shipped: sum.shipped + point.shipped, delivered: sum.delivered + point.delivered }),
    { pickedUp: 0, shipped: 0, delivered: 0 },
  );

  // ---- canonical shipment facts for every non-QA paid order (pool) ----
  const seenAwb = new Set<string>();
  let duplicateAwbsSkipped = 0;
  const shipFacts = new Map<string, ShipFact>();
  const placeOf = (order: IntelOrder) => {
    const dest = destByOrder.get(order.id);
    const state = normalizeIndiaState(dest?.state);
    const city = normalizeCity(dest?.city, state.code === UNKNOWN_STATE_CODE ? dest?.state : state.name);
    return { state, city };
  };
  const byPaid = [...nonQa].sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at)) || a.id.localeCompare(b.id));
  for (const order of byPaid) {
    const rows = shipsByOrder.get(order.id) || [];
    const ship = rateShipmentFor({ status: order.status, paid_at: order.paid_at, qa: false }, rows);
    if (!ship) continue;
    const awb = String(ship.awb || "").trim().toUpperCase();
    if (awb && seenAwb.has(awb)) {
      duplicateAwbsSkipped += 1;
      continue;
    }
    if (awb) seenAwb.add(awb);
    const lines = packageLinesFrom(
      (itemsByOrder.get(order.id) || []).map((item) => ({ qty: item.qty ?? null, product_id: item.product_id ?? null, weight_grams_snapshot: item.weight_grams_snapshot ?? null })),
      profiles,
    );
    const shipWeight = Number(ship.weight_grams) > 0 ? Number(ship.weight_grams) : null;
    const weightGrams = shipWeight ?? resolvePackageDisplay({ rows, lines })?.weight_grams ?? null;
    const place = placeOf(order);
    shipFacts.set(order.id, {
      order,
      stateCode: place.state.code,
      stateName: place.state.name,
      cityKey: place.city.key,
      city: place.city.city,
      courier: courierLabel(ship.courier_name),
      provider: providerLabel(ship.provider),
      ratePaise: savedCourierRatePaise(ship.provider_payload),
      weightGrams,
      band: weightBand(weightGrams),
      pickedUp: Boolean(ship.picked_up_at) || POSSESSED_SHIPMENT.has(String(ship.status || "").toLowerCase()),
      delivered: order.status === "DELIVERED" || String(ship.status || "").toLowerCase() === "delivered",
    });
  }
  const pool: RatedShipment[] = [];
  for (const fact of shipFacts.values()) {
    if (fact.ratePaise == null) continue;
    pool.push({ orderId: fact.order.id, stateCode: fact.stateCode, band: fact.band?.id || null, ratePaise: fact.ratePaise });
  }

  // ---- cohort aggregation (A) ----
  const subjectMap = new Map<string, { label: string; orders: Set<string>; units: number; net: number; spark: number[] }>();
  const stateMap = new Map<string, { name: string; orders: number; units: number; revenue: number; subjects: Map<string, number>; rates: number[]; couriers: Map<string, number>; anomalies: number; weights: number[]; shipments: number }>();
  const cityMap = new Map<string, { city: string; state: string; stateCode: string; orders: number; units: number; revenue: number; rates: number[]; couriers: Map<string, number> }>();
  const courierMap = new Map<string, { courier: string; provider: string; shipments: number; rates: number[]; pickedUp: number; delivered: number }>();
  const providerMap = new Map<string, { shipments: number; rates: number[] }>();
  const cohortRates: number[] = [];
  const burdens: number[] = [];
  const anomalies: RateAnomaly[] = [];
  let cohortUnits = 0;
  let cohortRevenue = 0;
  let cohortMerch = 0;
  let booked = 0;
  const methodSums = { delivery: { orders: 0, units: 0, revenue: 0 }, pickup: { orders: 0, units: 0, revenue: 0 } };

  for (const order of cohort) {
    const items = itemsByOrder.get(order.id) || [];
    const units = items.reduce((sum, item) => sum + qtyOf(item), 0);
    const revenue = order.total_paise || 0;
    cohortUnits += units;
    cohortRevenue += revenue;
    const methodSlot = isAcademyPickup(order) ? methodSums.pickup : methodSums.delivery;
    methodSlot.orders += 1;
    methodSlot.units += units;
    methodSlot.revenue += revenue;
    cohortMerch += Math.max(0, Math.round(revenue - (order.shipping_paise || 0)));
    const bucket = order.paid_at ? keyIndex.get(pointKey(new Date(order.paid_at), grain)) : undefined;

    const subjectLines = subjectLinesForOrder(order, items, products, bundles);
    for (const line of subjectLines) {
      const slot = subjectMap.get(line.subjectKey) || { label: line.subjectLabel, orders: new Set<string>(), units: 0, net: 0, spark: keys.map(() => 0) };
      slot.orders.add(order.id);
      slot.units += line.units;
      slot.net += line.netPaise;
      if (bucket != null) slot.spark[bucket] += line.units;
      subjectMap.set(line.subjectKey, slot);
    }

    const place = placeOf(order);
    const state = stateMap.get(place.state.code) || { name: place.state.name, orders: 0, units: 0, revenue: 0, subjects: new Map<string, number>(), rates: [], couriers: new Map<string, number>(), anomalies: 0, weights: [], shipments: 0 };
    state.orders += 1;
    state.units += units;
    state.revenue += revenue;
    for (const line of subjectLines) if (line.units) bump(state.subjects, line.subjectLabel, line.units);
    stateMap.set(place.state.code, state);

    const city = cityMap.get(place.city.key) || { city: place.city.city, state: place.city.state, stateCode: place.state.code, orders: 0, units: 0, revenue: 0, rates: [], couriers: new Map<string, number>() };
    city.orders += 1;
    city.units += units;
    city.revenue += revenue;
    cityMap.set(place.city.key, city);

    const fact = shipFacts.get(order.id);
    if (!fact) continue;
    booked += 1;
    state.shipments += 1;
    bump(state.couriers, fact.courier);
    bump(city.couriers, fact.courier);
    if (fact.weightGrams) state.weights.push(fact.weightGrams);
    const courierKey = `${fact.courier.toLowerCase()}|${fact.provider}`;
    const courier = courierMap.get(courierKey) || { courier: fact.courier, provider: fact.provider, shipments: 0, rates: [], pickedUp: 0, delivered: 0 };
    courier.shipments += 1;
    if (fact.pickedUp) courier.pickedUp += 1;
    if (fact.delivered) courier.delivered += 1;
    courierMap.set(courierKey, courier);
    const provider = providerMap.get(fact.provider) || { shipments: 0, rates: [] };
    provider.shipments += 1;
    providerMap.set(fact.provider, provider);
    if (fact.ratePaise == null) continue;

    cohortRates.push(fact.ratePaise);
    state.rates.push(fact.ratePaise);
    city.rates.push(fact.ratePaise);
    courier.rates.push(fact.ratePaise);
    provider.rates.push(fact.ratePaise);
    const burden = revenue > 0 ? Math.round((fact.ratePaise / revenue) * 1000) / 10 : null;
    if (burden != null) burdens.push(burden);

    const verdict = judgeRate({ orderId: order.id, stateCode: fact.stateCode, band: fact.band?.id || null, ratePaise: fact.ratePaise }, pool);
    if (verdict.flagged && verdict.medianPaise != null && verdict.comparison) {
      state.anomalies += 1;
      const difference = fact.ratePaise - verdict.medianPaise;
      const differencePct = Math.round((difference / verdict.medianPaise) * 100);
      const where = verdict.comparison === "state" ? ` ${fact.stateName}` : "";
      const scope = verdict.comparison === "state" ? "" : " nationally";
      anomalies.push({
        orderId: order.id,
        orderNo: String(order.order_no || order.id.slice(0, 8)),
        orderLabel: orderIndexLabel(String(order.order_no || "")) || String(order.order_no || order.id.slice(0, 8)),
        city: fact.city,
        state: fact.stateName,
        weightGrams: fact.weightGrams,
        weightBand: fact.band?.label || "",
        courier: fact.courier,
        provider: fact.provider,
        ratePaise: fact.ratePaise,
        peerMedianPaise: verdict.medianPaise,
        peerLowPaise: quantile(verdict.peers, 0.25) as number,
        peerHighPaise: quantile(verdict.peers, 0.75) as number,
        peerCount: verdict.peers.length,
        differencePaise: difference,
        differencePct,
        comparison: verdict.comparison,
        burdenPct: burden,
        reason: `${differencePct}% above similar ${fact.band?.label || ""}${where} shipments${scope}`.replace(/\s+/g, " "),
      });
    }
  }

  const subjectUnits = [...subjectMap.values()].reduce((sum, row) => sum + row.units, 0);
  const subjectNet = [...subjectMap.values()].reduce((sum, row) => sum + row.net, 0);
  const subjects: SubjectRow[] = [...subjectMap.entries()]
    .map(([key, row]) => ({
      key,
      label: row.label,
      orders: row.orders.size,
      units: row.units,
      netRevenuePaise: row.net,
      avgNetPerOrderPaise: row.orders.size ? Math.round(row.net / row.orders.size) : null,
      unitSharePct: pct(row.units, subjectUnits),
      revenueSharePct: pct(row.net, subjectNet),
      spark: row.spark,
    }))
    .sort((a, b) => b.netRevenuePaise - a.netRevenuePaise || b.orders - a.orders || a.label.localeCompare(b.label));

  const states: StateRow[] = [...stateMap.entries()]
    .map(([code, row]) => ({
      code,
      name: row.name,
      orders: row.orders,
      units: row.units,
      revenuePaise: row.revenue,
      aovPaise: row.orders ? Math.round(row.revenue / row.orders) : null,
      subjectUnits: [...row.subjects.entries()].map(([label, units]) => ({ label, units })).sort((a, b) => b.units - a.units || a.label.localeCompare(b.label)),
      topCourier: topKey(row.couriers),
      anomalies: row.anomalies,
      avgWeightGrams: row.weights.length ? Math.round(row.weights.reduce((a, b) => a + b, 0) / row.weights.length) : null,
      shipments: row.shipments,
      ...rateStats(row.rates),
    }))
    .sort((a, b) => b.orders - a.orders || b.revenuePaise - a.revenuePaise || a.name.localeCompare(b.name));

  const cities: CityRow[] = [...cityMap.entries()]
    .map(([key, row]) => ({
      key,
      city: row.city,
      state: row.state,
      stateCode: row.stateCode,
      orders: row.orders,
      units: row.units,
      revenuePaise: row.revenue,
      sharePct: pct(row.orders, cohort.length),
      topCourier: topKey(row.couriers),
      ...rateStats(row.rates),
    }))
    .sort((a, b) => b.orders - a.orders || b.revenuePaise - a.revenuePaise || a.city.localeCompare(b.city));

  const byCourier: CourierRow[] = [...courierMap.entries()]
    .map(([key, row]) => ({
      key,
      courier: row.courier,
      provider: row.provider,
      shipments: row.shipments,
      pickedUp: row.pickedUp,
      delivered: row.delivered,
      sharePct: pct(row.shipments, booked),
      ...rateStats(row.rates),
    }))
    .sort((a, b) => b.shipments - a.shipments || (a.avgPaise ?? 0) - (b.avgPaise ?? 0) || a.courier.localeCompare(b.courier));

  const byProvider: ProviderRow[] = [...providerMap.entries()]
    .map(([provider, row]) => ({ provider, shipments: row.shipments, ...rateStats(row.rates) }))
    .sort((a, b) => b.shipments - a.shipments || a.provider.localeCompare(b.provider));

  const atOrUnder100 = cohortRates.filter((rate) => rate <= 10000).length;
  const methodRow = (slot: { orders: number; units: number; revenue: number }): MethodRow => ({
    orders: slot.orders,
    units: slot.units,
    revenuePaise: slot.revenue,
    aovPaise: slot.orders ? Math.round(slot.revenue / slot.orders) : null,
    sharePct: pct(slot.orders, cohort.length),
  });
  const shipping: ShippingIntel = {
    ...rateStats(cohortRates),
    booked,
    paidOrders: methodSums.delivery.orders,
    atOrUnder100,
    over100: cohortRates.length - atOrUnder100,
    atOrUnder100Pct: pct(atOrUnder100, cohortRates.length),
    avgBurdenPct: burdens.length ? Math.round((burdens.reduce((a, b) => a + b, 0) / burdens.length) * 10) / 10 : null,
    distribution: rateDistribution(cohortRates),
    byState: [...states].filter((row) => row.shipments > 0).sort((a, b) => (b.avgPaise ?? -1) - (a.avgPaise ?? -1) || b.shipments - a.shipments),
    byCity: [...cities].filter((row) => row.count > 0).sort((a, b) => (b.avgPaise ?? -1) - (a.avgPaise ?? -1) || b.count - a.count),
    byCourier,
    byProvider,
    duplicateAwbsSkipped,
  };

  return {
    grain,
    methods: { delivery: methodRow(methodSums.delivery), pickup: methodRow(methodSums.pickup) },
    pickupOps: buildPickupOps(nonQa, start, end, input.todayStart, input.todayEnd, now),
    cohort: { orders: cohort.length, units: cohortUnits, revenuePaise: cohortRevenue, merchandisePaise: cohortMerch },
    subjects,
    fulfillment,
    fulfillmentTotals,
    today,
    now: nowCounts,
    states,
    cities,
    shipping,
    anomalies: anomalies.sort((a, b) => b.differencePaise - a.differencePaise),
    anomalyRule: ANOMALY_RULE,
  };
}

/** Academy Pickup operations, IST business days via the caller's today bounds. Descriptive only. */
export function buildPickupOps(
  orders: Array<{ status: string; paid_at: string | null; fulfillment_method?: string | null; ready_for_collection_at?: string | null; collected_at?: string | null }>,
  start: Date,
  end: Date,
  todayStart: Date,
  todayEnd: Date,
  now: Date,
): PickupOps {
  const pickups = orders.filter((order) => isAcademyPickup(order));
  const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
  const ready = pickups.filter((order) => order.status === "READY_FOR_COLLECTION" && order.ready_for_collection_at);
  const waits = ready.map((order) => Math.max(0, now.getTime() - ms(order.ready_for_collection_at))).filter(Number.isFinite);
  const day = 86_400_000;
  const paidToReady = pickups
    .filter((order) => inRange(order.ready_for_collection_at, start, end, now) && order.paid_at)
    .map((order) => ms(order.ready_for_collection_at) - ms(order.paid_at))
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  const collectedRange = pickups.filter((order) => order.status === "COLLECTED" && inRange(order.collected_at, start, end, now));
  const readyToCollected = collectedRange
    .map((order) => ms(order.collected_at) - ms(order.ready_for_collection_at))
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  return {
    readyNow: ready.length,
    waitingOver1d: waits.filter((w) => w > day).length,
    waitingOver3d: waits.filter((w) => w > 3 * day).length,
    oldestReadyMs: waits.length ? Math.max(...waits) : null,
    collectedInRange: collectedRange.length,
    readyToday: pickups.filter((order) => inRange(order.ready_for_collection_at, todayStart, todayEnd, now)).length,
    collectedToday: pickups.filter((order) => order.status === "COLLECTED" && inRange(order.collected_at, todayStart, todayEnd, now)).length,
    medianPaidToReadyMs: medianOf(paidToReady),
    paidToReadySample: paidToReady.length,
    medianReadyToCollectedMs: medianOf(readyToCollected),
    readyToCollectedSample: readyToCollected.length,
  };
}
