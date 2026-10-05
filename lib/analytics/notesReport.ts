import { getSupabaseAdmin } from "@/lib/supabase";
import {
  aggregateNotesAnalytics,
  notesRangeBounds,
  type NotesAnalyticsReport,
  type NotesEventRow,
  type NotesItemFact,
  type NotesOrderFact,
  type NotesRangeKey,
} from "./notesCommerce";
import { buildNotesVisuals, comparisonWindow, destinationForOrder, type NotesDestination, type NotesVisuals } from "./notesVisuals";

export interface NotesAnalyticsView extends NotesAnalyticsReport {
  visuals: NotesVisuals | null;
  /** True when the range has more behaviour events than MAX_NOTES_EVENTS; behaviour metrics are then partial. */
  eventsCapped?: boolean;
}

export const EVENT_NAMES = [
  "notes_store_viewed",
  "notes_product_viewed",
  "notes_bundle_viewed",
  "notes_product_clicked",
  "notes_sample_opened",
  "notes_physical_video_play",
  "notes_physical_video_50",
  "notes_physical_video_completed",
  "notes_teaching_preview_started",
  "notes_teaching_video_50",
  "notes_teaching_video_completed",
  "notes_added_to_cart",
  "notes_checkout_started",
  "notes_payment_initiated",
  "notes_payment_failed",
  "notes_checkout_validation_error",
  "notes_checkout_api_error",
  "notes_shipping_quote_error",
  "notes_shop_after_teaching_clicked",
  "notes_purchase",
];

export type AdminDb = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

/** Safety ceiling for one range. Reaching it is reported on the page, never silent. */
export const MAX_NOTES_EVENTS = 100000;
const PAGE = 1000;

/**
 * Every qualifying event in the range. Supabase returns at most 1,000 rows per request,
 * so pages are read four at a time in a stable order (occurred_at, event_id) and
 * de-duplicated by event_id. Ascending order keeps events that arrive mid-read after
 * the pages already fetched.
 */
export async function loadEvents(db: AdminDb, start: Date, end: Date): Promise<{ events: NotesEventRow[]; ok: boolean; capped: boolean }> {
  const base = () =>
    db
      .from("analytics_events")
      .select("event_id,event_name,session_id,visitor_id,occurred_at,page_path,device,attribution,props,is_bot")
      .in("event_name", EVENT_NAMES)
      .gte("occurred_at", start.toISOString())
      .lt("occurred_at", end.toISOString())
      .eq("is_bot", false);
  const { count, error: countError } = await db
    .from("analytics_events")
    .select("event_id", { count: "exact", head: true })
    .in("event_name", EVENT_NAMES)
    .gte("occurred_at", start.toISOString())
    .lt("occurred_at", end.toISOString())
    .eq("is_bot", false);
  const known = countError || count == null ? null : count;
  const target = Math.min(known ?? MAX_NOTES_EVENTS, MAX_NOTES_EVENTS);
  const seen = new Set<string>();
  const events: NotesEventRow[] = [];
  let ok = !countError;
  let exhausted = false;
  for (let from = 0; from < target && !exhausted; from += PAGE * 4) {
    const offsets = [0, 1, 2, 3].map((i) => from + i * PAGE).filter((offset) => offset < target);
    const pages = await Promise.all(offsets.map((offset) => base().order("occurred_at", { ascending: true }).order("event_id", { ascending: true }).range(offset, offset + PAGE - 1)));
    for (const { data, error } of pages) {
      if (error) ok = false;
      const rows = (data || []) as Array<NotesEventRow & { event_id?: string }>;
      for (const row of rows) {
        const id = row.event_id || `${row.occurred_at}|${row.session_id}|${row.event_name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        events.push(row);
      }
      if (rows.length < PAGE) exhausted = true;
    }
  }
  return { events, ok, capped: known == null ? events.length >= MAX_NOTES_EVENTS : known > MAX_NOTES_EVENTS };
}

/** Captured orders paid in the range, paged past the 1,000-row response limit. */
async function loadRangeOrders(db: AdminDb, start: Date, end: Date): Promise<{ orders: NotesOrderFact[]; ok: boolean }> {
  const orders: NotesOrderFact[] = [];
  for (let from = 0; from < 50000; from += PAGE) {
    const { data, error } = await db
      .from("store_orders")
      .select("id,status,total_paise,discount_paise,paid_at,promo_code,attribution_source,attribution_platform,attribution_json,shipping_address_id,phone_key,fulfillment_method,customer_location_snapshot")
      .not("paid_at", "is", null)
      .gte("paid_at", start.toISOString())
      .lt("paid_at", end.toISOString())
      .order("paid_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { orders, ok: false };
    const rows = (data || []) as NotesOrderFact[];
    orders.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { orders, ok: true };
}

async function loadFacts(db: AdminDb, start: Date, end: Date, withItems: boolean): Promise<{ events: NotesEventRow[]; orders: NotesOrderFact[]; items: NotesItemFact[]; ok: boolean; eventsCapped: boolean }> {
  const [eventRead, orderRead] = await Promise.all([loadEvents(db, start, end), loadRangeOrders(db, start, end)]);
  const events = eventRead.events;
  let ok = eventRead.ok && orderRead.ok;
  const orders = orderRead.orders;
  let items: NotesItemFact[] = [];
  if (withItems && orders.length) {
    const loaded = await selectIn(db, "store_order_items", "order_id", orders.map((order) => order.id), "order_id,product_id,name_snapshot,sku_snapshot,line_total_paise,qty");
    if (!loaded.ok) ok = false;
    items = loaded.rows as unknown as NotesItemFact[];
  }
  return { events, orders, items, ok, eventsCapped: eventRead.capped };
}

/** Batched `in` reads, 200 ids per request, up to four requests at a time. */
export async function selectIn(db: AdminDb, table: "store_order_items" | "store_invoices" | "store_addresses", column: string, ids: string[], columns: string): Promise<{ rows: Array<Record<string, unknown>>; ok: boolean }> {
  const rows: Array<Record<string, unknown>> = [];
  const unique = [...new Set(ids.filter(Boolean))];
  const loose = db as unknown as {
    from: (name: string) => {
      select: (cols: string) => {
        in: (col: string, values: string[]) => Promise<{ data: unknown[] | null; error: { message?: string } | null }>;
      };
    };
  };
  const slices: string[][] = [];
  for (let index = 0; index < unique.length; index += 200) slices.push(unique.slice(index, index + 200));
  for (let index = 0; index < slices.length; index += 4) {
    const results = await Promise.all(slices.slice(index, index + 4).map((slice) => loose.from(table).select(columns).in(column, slice)));
    for (const { data, error } of results) {
      if (error) return { rows: [], ok: false };
      rows.push(...((data || []) as Array<Record<string, unknown>>));
    }
  }
  return { rows, ok: true };
}

function placeOf(snapshot: unknown): { city: string | null; state: string | null } | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const row = snapshot as { city?: unknown; state?: unknown };
  const city = typeof row.city === "string" ? row.city : null;
  const state = typeof row.state === "string" ? row.state : null;
  if (!(city || "").trim() && !(state || "").trim()) return null;
  return { city, state };
}

/** Delivery city comes from the invoice shipping snapshot, then the order ship-to. Courier hubs are not read. */
export async function loadDestinations(db: AdminDb, orders: Array<Pick<NotesOrderFact, "id" | "shipping_address_id" | "customer_location_snapshot">>): Promise<{ rows: NotesDestination[]; ok: boolean }> {
  if (!orders.length) return { rows: [], ok: true };
  const ids = orders.map((order) => order.id);
  const invoices = await selectIn(db, "store_invoices", "order_id", ids, "order_id,shipping_snapshot");
  const addressIds = orders.map((order) => order.shipping_address_id).filter((id): id is string => Boolean(id));
  const addresses = addressIds.length ? await selectIn(db, "store_addresses", "id", addressIds, "id,city,state") : { rows: [], ok: true };
  if (!invoices.ok && !addresses.ok) return { rows: [], ok: false };
  const snapshotByOrder = new Map<string, { city: string | null; state: string | null }>();
  if (invoices.ok) {
    for (const row of invoices.rows) {
      const place = placeOf(row.shipping_snapshot);
      if (place && typeof row.order_id === "string") snapshotByOrder.set(row.order_id, place);
    }
  }
  const addressById = new Map<string, { city: string | null; state: string | null }>();
  if (addresses.ok) {
    for (const row of addresses.rows) {
      if (typeof row.id !== "string") continue;
      addressById.set(row.id, {
        city: typeof row.city === "string" ? row.city : null,
        state: typeof row.state === "string" ? row.state : null,
      });
    }
  }
  return {
    ok: invoices.ok || addresses.ok,
    rows: orders.map((order) => destinationForOrder(
      order.id,
      invoices.ok ? snapshotByOrder.get(order.id) : null,
      addresses.ok && order.shipping_address_id ? addressById.get(order.shipping_address_id) : null,
      order.customer_location_snapshot || null,
    )),
  };
}

export async function loadNotesAnalytics(input: { key: NotesRangeKey; from?: string; to?: string; now?: Date }): Promise<NotesAnalyticsView> {
  const now = input.now || new Date();
  const bounds = notesRangeBounds(input.key, now, { from: input.from, to: input.to });
  const empty = aggregateNotesAnalytics([], [], []);
  const db = getSupabaseAdmin();
  if (!db) return { ...empty, visuals: null, eventsCapped: false };
  const current = await loadFacts(db, bounds.start, bounds.end, true);
  const report = aggregateNotesAnalytics(current.events, current.orders, current.items);
  let visuals: NotesVisuals | null = null;
  try {
    const prior = comparisonWindow(bounds, now);
    let previousKpis: NotesAnalyticsReport["kpis"] | null = null;
    let compare = false;
    if (prior) {
      const previous = await loadFacts(db, prior.start, prior.end, false);
      if (previous.ok) {
        previousKpis = aggregateNotesAnalytics(previous.events, previous.orders, []).kpis;
        compare = true;
      }
    }
    const destinations = await loadDestinations(db, current.orders);
    visuals = buildNotesVisuals({
      events: current.events,
      orders: current.orders,
      items: current.items,
      destinations: destinations.rows,
      citiesAvailable: destinations.ok,
      start: bounds.start,
      end: bounds.end,
      now,
      label: bounds.label,
      previousKpis,
      compare,
    });
  } catch {
    visuals = null;
  }
  return { ...report, visuals, eventsCapped: current.eventsCapped };
}
