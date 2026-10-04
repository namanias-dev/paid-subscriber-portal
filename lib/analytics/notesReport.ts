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
}

const EVENT_NAMES = [
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

async function loadFacts(db: AdminDb, start: Date, end: Date, withItems: boolean): Promise<{ events: NotesEventRow[]; orders: NotesOrderFact[]; items: NotesItemFact[]; ok: boolean }> {
  const events: NotesEventRow[] = [];
  let ok = true;
  for (let from = 0; from < 8000; from += 1000) {
    const { data, error } = await db
      .from("analytics_events")
      .select("event_name,session_id,visitor_id,occurred_at,page_path,device,attribution,props,is_bot")
      .in("event_name", EVENT_NAMES)
      .gte("occurred_at", start.toISOString())
      .lt("occurred_at", end.toISOString())
      .eq("is_bot", false)
      .order("occurred_at", { ascending: false })
      .range(from, from + 999);
    if (error) ok = false;
    const rows = (data || []) as NotesEventRow[];
    events.push(...rows);
    if (rows.length < 1000) break;
  }
  const { data: orderRows, error: orderError } = await db
    .from("store_orders")
    .select("id,status,total_paise,discount_paise,paid_at,promo_code,attribution_source,attribution_platform,attribution_json,shipping_address_id,phone_key")
    .not("paid_at", "is", null)
    .gte("paid_at", start.toISOString())
    .lt("paid_at", end.toISOString())
    .limit(2000);
  if (orderError) ok = false;
  const orders = (orderRows || []) as NotesOrderFact[];
  let items: NotesItemFact[] = [];
  if (withItems && orders.length) {
    const loaded = await selectIn(db, "store_order_items", "order_id", orders.map((order) => order.id), "order_id,product_id,name_snapshot,sku_snapshot,line_total_paise,qty");
    if (!loaded.ok) ok = false;
    items = loaded.rows as unknown as NotesItemFact[];
  }
  return { events, orders, items, ok };
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
export async function loadDestinations(db: AdminDb, orders: Array<Pick<NotesOrderFact, "id" | "shipping_address_id">>): Promise<{ rows: NotesDestination[]; ok: boolean }> {
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
    )),
  };
}

export async function loadNotesAnalytics(input: { key: NotesRangeKey; from?: string; to?: string; now?: Date }): Promise<NotesAnalyticsView> {
  const now = input.now || new Date();
  const bounds = notesRangeBounds(input.key, now, { from: input.from, to: input.to });
  const empty = aggregateNotesAnalytics([], [], []);
  const db = getSupabaseAdmin();
  if (!db) return { ...empty, visuals: null };
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
  return { ...report, visuals };
}
