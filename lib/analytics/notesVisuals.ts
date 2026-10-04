/**
 * Notes analytics visuals. Pure aggregation on top of the existing commerce
 * definitions: captured order totals, unique first-party sessions, IST days.
 */
import type { NotesAnalyticsReport, NotesEventRow, NotesItemFact, NotesOrderFact } from "./notesCommerce";
import { notesBusinessEvents, notesBusinessOrders } from "./notesCommerce";
import { formatPaise } from "@/lib/store/money";

const IST = "Asia/Kolkata";

export interface NotesDestination {
  orderId: string;
  city: string | null;
  state: string | null;
}

export interface NotesPoint {
  key: string;
  label: string;
  /** Quiet axis tick. Blank when the label would crowd the chart. */
  axis: string;
  orders: number;
  units: number;
  revenuePaise: number;
  customers: number;
  visitors: number;
  productViewers: number;
  addToCarts: number;
  checkouts: number;
  conversionPct: number | null;
  aovPaise: number | null;
}

export interface NotesTrend {
  points: Array<number | null>;
  delta: string;
  tone: "up" | "down" | "flat" | "new" | "none";
}

export interface NotesCityRow {
  city: string;
  state: string;
  orders: number;
  units: number;
  revenuePaise: number;
  sharePct: number | null;
}

export interface NotesVisuals {
  grain: "hour" | "day";
  subtitle: string;
  points: NotesPoint[];
  /** Null when the destination query failed. An empty list means no paid orders. */
  cities: NotesCityRow[] | null;
  totals: { orders: number; units: number; revenuePaise: number };
  trends: {
    visitors: NotesTrend;
    productViewers: NotesTrend;
    addToCarts: NotesTrend;
    checkouts: NotesTrend;
    paidOrders: NotesTrend;
    conversion: NotesTrend;
    revenue: NotesTrend;
    aov: NotesTrend;
  };
}

export function istDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function istHour(date: Date): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  const value = Number(hour);
  if (!Number.isFinite(value)) return 0;
  return value % 24;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function istDayLabel(key: string): string {
  const [, month, day] = key.split("-").map(Number);
  return `${day || 1} ${MONTHS[(month || 1) - 1] || ""}`;
}

export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const face = hour % 12 || 12;
  return `${face}${suffix}`;
}

/** Equal-length window immediately before the selected range. */
export function previousBounds(bounds: { start: Date; end: Date }): { start: Date; end: Date } {
  const span = Math.max(0, bounds.end.getTime() - bounds.start.getTime());
  return { start: new Date(bounds.start.getTime() - span), end: new Date(bounds.start.getTime()) };
}

/**
 * Comparison window for KPI deltas.
 * Closed ranges, and open ranges longer than a day, use the equal-length window
 * immediately before the selection. An open single day (Today) uses the same
 * clock interval on the previous day, so a partial afternoon is not compared
 * with a full previous day.
 */
export function comparisonWindow(bounds: { start: Date; end: Date }, now: Date): { start: Date; end: Date } | null {
  if (bounds.end.getTime() <= bounds.start.getTime()) return null;
  const open = bounds.end.getTime() > now.getTime();
  const span = bounds.end.getTime() - bounds.start.getTime();
  if (open && span <= 36 * 3600 * 1000) {
    const effectiveEnd = Math.min(bounds.end.getTime(), now.getTime());
    if (effectiveEnd <= bounds.start.getTime()) return null;
    const day = 86400000;
    return { start: new Date(bounds.start.getTime() - day), end: new Date(effectiveEnd - day) };
  }
  return previousBounds(bounds);
}

export function periodDelta(current: number | null, previous: number | null): Pick<NotesTrend, "delta" | "tone"> {
  if (current != null && !Number.isFinite(current)) return { delta: "—", tone: "none" };
  if (previous != null && !Number.isFinite(previous)) return { delta: "—", tone: "none" };
  if (current == null && previous == null) return { delta: "—", tone: "none" };
  if ((previous == null || previous === 0) && (current == null || current === 0)) return { delta: "—", tone: "none" };
  if (previous == null || previous === 0) return { delta: "New", tone: "new" };
  if (current == null) return { delta: "—", tone: "none" };
  const pct = Math.round((((current - previous) / previous) * 100) * 10) / 10;
  if (!Number.isFinite(pct)) return { delta: "—", tone: "none" };
  if (pct === 0) return { delta: "0%", tone: "flat" };
  const sign = pct > 0 ? "+" : "−";
  return { delta: `${sign}${Math.abs(pct)}%`, tone: pct > 0 ? "up" : "down" };
}

function placeDisplay(raw: string): string {
  const collapsed = raw.trim().replace(/[.,]+/g, "").replace(/\s+/g, " ").replace(/\s+city$/i, "").trim();
  if (!collapsed) return "";
  return collapsed.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function placeKey(raw: string): string {
  return placeDisplay(raw).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Group obvious casing and a trailing "City". Distinct names stay apart. */
export function normalizeCity(city: string | null | undefined, state: string | null | undefined): { city: string; state: string; key: string } {
  const cityLabel = placeDisplay(city || "");
  const stateLabel = placeDisplay(state || "");
  if (!cityLabel && !stateLabel) return { city: "Unspecified", state: "—", key: "unspecified" };
  return {
    city: cityLabel || "Unspecified",
    state: stateLabel || "—",
    key: `${placeKey(cityLabel) || "unspecified"}|${placeKey(stateLabel) || ""}`,
  };
}

/** Invoice snapshot wins. The order ship-to is the fallback. Courier hubs are never an input. */
export function destinationForOrder(
  orderId: string,
  snapshot: { city?: string | null; state?: string | null } | null | undefined,
  address: { city?: string | null; state?: string | null } | null | undefined,
): NotesDestination {
  const snapCity = (snapshot?.city || "").trim();
  const snapState = (snapshot?.state || "").trim();
  if (snapCity || snapState) return { orderId, city: snapCity || null, state: snapState || null };
  return { orderId, city: (address?.city || "").trim() || null, state: (address?.state || "").trim() || null };
}

function ratio(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function actor(event: NotesEventRow, index: number): string {
  return event.session_id || event.visitor_id || `anon:${index}`;
}

export function grainFor(start: Date, end: Date): "hour" | "day" {
  return end.getTime() - start.getTime() <= 36 * 3600 * 1000 ? "hour" : "day";
}

export function bucketKeys(start: Date, end: Date, grain: "hour" | "day", now: Date): string[] {
  const cap = Math.min(end.getTime(), now.getTime());
  const keys: string[] = [];
  if (grain === "day") {
    let cursor = start.getTime();
    while (cursor < end.getTime() && cursor <= cap) {
      keys.push(istDayKey(new Date(cursor)));
      cursor += 86400000;
    }
    if (keys.length === 0) keys.push(istDayKey(start));
    return keys;
  }
  let cursor = start.getTime();
  while (cursor < end.getTime() && cursor <= cap) {
    const at = new Date(cursor);
    keys.push(`${istDayKey(at)}T${String(istHour(at)).padStart(2, "0")}`);
    cursor += 3600000;
  }
  if (keys.length === 0) keys.push(`${istDayKey(start)}T${String(istHour(start)).padStart(2, "0")}`);
  return keys;
}

export function pointKey(at: Date, grain: "hour" | "day"): string {
  return grain === "day" ? istDayKey(at) : `${istDayKey(at)}T${String(istHour(at)).padStart(2, "0")}`;
}

export function pointLabel(key: string, grain: "hour" | "day"): string {
  if (grain === "day") return istDayLabel(key);
  const [day, hour] = key.split("T");
  return `${istDayLabel(day)} ${hourLabel(Number(hour))}`;
}

export function pointAxis(key: string, grain: "hour" | "day"): string {
  if (grain === "day") return istDayLabel(key);
  const hour = Number(key.split("T")[1]);
  return hour % 4 === 0 ? hourLabel(hour) : "";
}

function unitsByOrder(items: NotesItemFact[], paidIds: Set<string>, productId?: string | null): Map<string, number> {
  const units = new Map<string, number>();
  for (const item of items) {
    if (!paidIds.has(item.order_id)) continue;
    if (productId && item.product_id !== productId) continue;
    const qty = item.qty == null || item.qty < 1 ? 1 : item.qty;
    units.set(item.order_id, (units.get(item.order_id) || 0) + qty);
  }
  return units;
}

function inWindow(at: Date, start: Date, end: Date, now: Date): boolean {
  return at >= start && at < end && at <= now;
}

export function buildNotesVisuals(input: {
  events: NotesEventRow[];
  orders: NotesOrderFact[];
  items?: NotesItemFact[];
  destinations?: NotesDestination[];
  /** False when the city query failed. Timeline and KPIs still render. */
  citiesAvailable?: boolean;
  /** Future product subset. Unset means every captured order. */
  productId?: string | null;
  start: Date;
  end: Date;
  now?: Date;
  label: string;
  previousKpis?: NotesAnalyticsReport["kpis"] | null;
  /** True only when the previous window loaded. Unknown prior data stays "—". */
  compare?: boolean;
}): NotesVisuals {
  const now = input.now || new Date();
  const grain = grainFor(input.start, input.end);
  const events = notesBusinessEvents(input.events).filter((event) => inWindow(new Date(event.occurred_at), input.start, input.end, now));
  let orders = notesBusinessOrders(input.orders).filter((order) => order.paid_at && inWindow(new Date(order.paid_at), input.start, input.end, now));
  const paidIds = new Set(orders.map((order) => order.id));
  const units = unitsByOrder(input.items || [], paidIds, input.productId);
  const lineRevenue = new Map<string, number>();
  if (input.productId) {
    for (const item of input.items || []) {
      if (!paidIds.has(item.order_id) || item.product_id !== input.productId) continue;
      lineRevenue.set(item.order_id, (lineRevenue.get(item.order_id) || 0) + (item.line_total_paise || 0));
    }
    orders = orders.filter((order) => (units.get(order.id) || 0) > 0);
  }
  const revenueOf = (order: NotesOrderFact) => input.productId ? (lineRevenue.get(order.id) || 0) : (order.total_paise || 0);
  const keys = bucketKeys(input.start, input.end, grain, now);
  const blank = (): NotesPoint => ({
    key: "",
    label: "",
    axis: "",
    orders: 0,
    units: 0,
    revenuePaise: 0,
    customers: 0,
    visitors: 0,
    productViewers: 0,
    addToCarts: 0,
    checkouts: 0,
    conversionPct: null,
    aovPaise: null,
  });
  const points = new Map<string, NotesPoint>();
  for (const key of keys) points.set(key, { ...blank(), key, label: pointLabel(key, grain), axis: pointAxis(key, grain) });

  const visitors = new Map<string, Set<string>>();
  const viewers = new Map<string, Set<string>>();
  const carts = new Map<string, Set<string>>();
  const checks = new Map<string, Set<string>>();
  const ensure = (map: Map<string, Set<string>>, key: string) => {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key)!;
  };
  events.forEach((event, index) => {
    const at = new Date(event.occurred_at);
    const key = pointKey(at, grain);
    if (!points.has(key)) return;
    const id = actor(event, index);
    if (event.event_name === "notes_store_viewed") ensure(visitors, key).add(id);
    if (event.event_name === "notes_product_viewed" || event.event_name === "notes_bundle_viewed") ensure(viewers, key).add(id);
    if (event.event_name === "notes_added_to_cart") ensure(carts, key).add(id);
    if (event.event_name === "notes_checkout_started") ensure(checks, key).add(id);
  });

  const buyers = new Map<string, Set<string>>();
  for (const order of orders) {
    if (!order.paid_at) continue;
    const at = new Date(order.paid_at);
    const key = pointKey(at, grain);
    const point = points.get(key);
    if (!point) continue;
    point.orders += 1;
    point.units += units.get(order.id) || 0;
    point.revenuePaise += revenueOf(order);
    ensure(buyers, key).add(order.phone_key || order.id);
  }
  for (const point of points.values()) {
    point.visitors = visitors.get(point.key)?.size || 0;
    point.productViewers = viewers.get(point.key)?.size || 0;
    point.addToCarts = carts.get(point.key)?.size || 0;
    point.checkouts = checks.get(point.key)?.size || 0;
    point.customers = buyers.get(point.key)?.size || 0;
    point.conversionPct = ratio(point.orders, point.visitors);
    point.aovPaise = point.orders ? Math.round(point.revenuePaise / point.orders) : null;
  }
  const series = [...points.values()];

  const cities = input.citiesAvailable === false ? null : cityRows(orders, units, input.destinations || [], revenueOf);
  const prev = input.compare ? input.previousKpis : null;
  const currentKpis = kpiFromSeries(events, orders, revenueOf);
  const trend = (pointsOf: Array<number | null>, currentValue: number | null, previousValue: number | null): NotesTrend => ({
    points: pointsOf,
    ...(input.compare ? periodDelta(currentValue, previousValue ?? null) : { delta: "—", tone: "none" as const }),
  });

  return {
    grain,
    subtitle: subtitleFor(input.label, grain, input.start),
    points: series,
    cities,
    totals: {
      orders: orders.length,
      units: orders.reduce((sum, order) => sum + (units.get(order.id) || 0), 0),
      revenuePaise: orders.reduce((sum, order) => sum + revenueOf(order), 0),
    },
    trends: {
      visitors: trend(series.map((point) => point.visitors), currentKpis.visitors, prev?.visitors ?? null),
      productViewers: trend(series.map((point) => point.productViewers), currentKpis.productViewers, prev?.productViewers ?? null),
      addToCarts: trend(series.map((point) => point.addToCarts), currentKpis.addToCarts, prev?.addToCarts ?? null),
      checkouts: trend(series.map((point) => point.checkouts), currentKpis.checkouts, prev?.checkouts ?? null),
      paidOrders: trend(series.map((point) => point.orders), currentKpis.paidOrders, prev?.paidOrders ?? null),
      conversion: trend(series.map((point) => point.conversionPct), currentKpis.conversionPct, prev?.conversionPct ?? null),
      revenue: trend(series.map((point) => point.revenuePaise), currentKpis.revenuePaise, prev?.revenuePaise ?? null),
      aov: trend(series.map((point) => point.aovPaise), currentKpis.aovPaise, prev?.aovPaise ?? null),
    },
  };
}

function subtitleFor(label: string, grain: "hour" | "day", start: Date): string {
  const grainLabel = grain === "hour" ? "hourly" : "daily";
  if (label === "This month") {
    const key = istDayKey(start);
    const [year, month] = key.split("-").map(Number);
    return `${MONTHS[(month || 1) - 1]} ${year} · ${grainLabel}`;
  }
  const custom = label.match(/^(\d{4}-\d{2}-\d{2}) – (\d{4}-\d{2}-\d{2})$/);
  if (custom) return `${istDayLabel(custom[1])}–${istDayLabel(custom[2])} · ${grainLabel}`;
  return `${label} · ${grainLabel}`;
}

function kpiFromSeries(events: NotesEventRow[], orders: NotesOrderFact[], revenueOf: (order: NotesOrderFact) => number): NotesAnalyticsReport["kpis"] {
  const people = (names: Set<string>) => {
    const ids = new Set<string>();
    events.forEach((event, index) => {
      if (names.has(event.event_name)) ids.add(actor(event, index));
    });
    return ids.size;
  };
  const visitors = people(new Set(["notes_store_viewed"]));
  const productViewers = people(new Set(["notes_product_viewed", "notes_bundle_viewed"]));
  const addToCarts = people(new Set(["notes_added_to_cart"]));
  const checkouts = people(new Set(["notes_checkout_started"]));
  const paymentAttempts = people(new Set(["notes_payment_initiated"]));
  const paidOrders = orders.length;
  const revenuePaise = orders.reduce((sum, order) => sum + revenueOf(order), 0);
  return {
    visitors,
    productViewers,
    addToCarts,
    checkouts,
    paymentAttempts,
    paidOrders,
    conversionPct: ratio(paidOrders, visitors),
    revenuePaise,
    aovPaise: paidOrders ? Math.round(revenuePaise / paidOrders) : null,
  };
}

export type CityMetric = "orders" | "units" | "revenue";

export function rankCities(cities: NotesCityRow[], metric: CityMetric): NotesCityRow[] {
  const value = (row: NotesCityRow) => metric === "units" ? row.units : metric === "revenue" ? row.revenuePaise : row.orders;
  return [...cities].sort((a, b) => value(b) - value(a) || b.orders - a.orders || a.city.localeCompare(b.city));
}

function cityRows(
  orders: NotesOrderFact[],
  units: Map<string, number>,
  destinations: NotesDestination[],
  revenueOf: (order: NotesOrderFact) => number,
): NotesCityRow[] {
  const byOrder = new Map(destinations.map((row) => [row.orderId, row]));
  const groups = new Map<string, NotesCityRow>();
  for (const order of orders) {
    const dest = byOrder.get(order.id);
    const place = normalizeCity(dest?.city, dest?.state);
    const row = groups.get(place.key) || { city: place.city, state: place.state, orders: 0, units: 0, revenuePaise: 0, sharePct: null };
    row.orders += 1;
    row.units += units.get(order.id) || 0;
    row.revenuePaise += revenueOf(order);
    groups.set(place.key, row);
  }
  const total = orders.length;
  return [...groups.values()]
    .map((row) => ({ ...row, sharePct: ratio(row.orders, total) }))
    .sort((a, b) => b.orders - a.orders || b.revenuePaise - a.revenuePaise || a.city.localeCompare(b.city));
}

export function salesTooltipModel(point: Pick<NotesPoint, "label" | "orders" | "units" | "revenuePaise" | "aovPaise" | "customers">): Array<{ label: string; value: string }> {
  return [
    { label: "Paid orders", value: String(point.orders) },
    { label: "Paid units", value: String(point.units) },
    { label: "Revenue", value: formatPaise(point.revenuePaise) },
    { label: "AOV", value: point.aovPaise == null ? "—" : formatPaise(point.aovPaise) },
    { label: "Paid customers", value: String(point.customers) },
  ];
}

/** Straight sparkline. Nulls break the stroke so an empty day is not drawn as zero. */
export function sparklinePath(values: Array<number | null>, width = 96, height = 22): string {
  const nums = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (nums.length < 2) return "";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const pad = 1.5;
  let path = "";
  let drawing = false;
  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) {
      drawing = false;
      return;
    }
    const x = (index / Math.max(1, values.length - 1)) * (width - pad * 2) + pad;
    const y = pad + (1 - (value - min) / span) * (height - pad * 2);
    path += `${drawing ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    drawing = true;
  });
  return path;
}
