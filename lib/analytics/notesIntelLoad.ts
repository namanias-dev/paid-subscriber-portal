/**
 * Server loader for Notes analytics intelligence. Read-only.
 *
 * Every read is a paginated scan or a 200-id batched `in`, so a page load costs
 * a bounded number of requests regardless of order count (no per-order reads).
 * Runs beside the core KPI loader; a failure here returns `null` and only the
 * intelligence sections show an error.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { notesRangeBounds, type NotesRangeKey } from "./notesCommerce";
import { loadDestinations, type AdminDb } from "./notesReport";
import { buildNotesIntel, type IntelBundleItem, type IntelItem, type IntelOrder, type IntelProduct, type IntelShipment, type NotesIntel } from "./notesIntel";

const ORDER_COLUMNS =
  "id,order_no,status,total_paise,shipping_paise,discount_paise,paid_at,shipped_at,delivered_at,shipping_address_id,promo_code,attribution_source,attribution_json";
const MAX_ORDERS = 20000;

/** Statuses that can carry a booked shipment or fulfillment event. */
const SHIPMENT_STATUSES = new Set([
  "PACKED", "READY_FOR_PICKUP", "PICKUP_SCHEDULED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED",
  "DELIVERY_FAILED", "REATTEMPT_REQUESTED", "RTO_INITIATED", "RTO_IN_TRANSIT", "RTO_DELIVERED",
  "RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_PICKUP_SCHEDULED", "RETURN_IN_TRANSIT", "RETURN_RECEIVED",
  "REFUND_PENDING", "REFUNDED", "PARTIALLY_REFUNDED",
]);

async function paidOrders(db: AdminDb): Promise<IntelOrder[]> {
  const rows: IntelOrder[] = [];
  for (let from = 0; from < MAX_ORDERS; from += 1000) {
    const { data, error } = await db
      .from("store_orders")
      .select(ORDER_COLUMNS)
      .not("paid_at", "is", null)
      .order("paid_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`orders: ${error.message}`);
    const page = (data || []) as unknown as IntelOrder[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

/** 200 ids per request, four requests at a time. One failed batch fails the read. */
async function batchIn(db: AdminDb, table: "store_order_items" | "store_shipments", ids: string[], columns: string): Promise<Array<Record<string, unknown>>> {
  const loose = db as unknown as {
    from: (name: string) => {
      select: (cols: string) => {
        in: (col: string, values: string[]) => Promise<{ data: unknown[] | null; error: { message?: string } | null }>;
      };
    };
  };
  const unique = [...new Set(ids.filter(Boolean))];
  const slices: string[][] = [];
  for (let index = 0; index < unique.length; index += 200) slices.push(unique.slice(index, index + 200));
  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < slices.length; index += 4) {
    const results = await Promise.all(slices.slice(index, index + 4).map((slice) => loose.from(table).select(columns).in("order_id", slice)));
    for (const { data, error } of results) {
      if (error) throw new Error(`${table}: ${error.message || "read failed"}`);
      rows.push(...((data || []) as Array<Record<string, unknown>>));
    }
  }
  return rows;
}

async function catalogue(db: AdminDb): Promise<{ products: IntelProduct[]; bundles: IntelBundleItem[] }> {
  const [products, bundles] = await Promise.all([
    db.from("store_products").select("id,name,short_name,subject,kind,selling_price_paise,weight_grams,length_mm,width_mm,height_mm").limit(1000),
    db.from("store_bundle_items").select("bundle_id,component_id,qty").limit(2000),
  ]);
  if (products.error) throw new Error(`products: ${products.error.message}`);
  return {
    products: (products.data || []) as unknown as IntelProduct[],
    bundles: bundles.error ? [] : ((bundles.data || []) as unknown as IntelBundleItem[]),
  };
}

export async function loadNotesIntel(input: { key: NotesRangeKey; from?: string; to?: string; now?: Date }): Promise<NotesIntel | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const now = input.now || new Date();
  const bounds = notesRangeBounds(input.key, now, { from: input.from, to: input.to });
  const todayBounds = notesRangeBounds("today", now);
  try {
    const [orders, cat] = await Promise.all([paidOrders(db), catalogue(db)]);
    const ids = orders.map((order) => order.id);
    const shipIds = orders.filter((order) => SHIPMENT_STATUSES.has(order.status) || order.shipped_at || order.delivered_at).map((order) => order.id);
    const [items, ships, places] = await Promise.all([
      batchIn(db, "store_order_items", ids, "order_id,product_id,name_snapshot,qty,line_total_paise,weight_grams_snapshot"),
      batchIn(db, "store_shipments", shipIds, "order_id,provider,courier_name,status,awb,provider_payload,weight_grams,length_mm,width_mm,height_mm,picked_up_at,delivered_at,created_at"),
      loadDestinations(db, orders),
    ]);
    if (!places.ok) throw new Error("destinations");
    return buildNotesIntel({
      orders,
      items: items as unknown as IntelItem[],
      products: cat.products,
      bundleItems: cat.bundles,
      shipments: ships as unknown as IntelShipment[],
      destinations: places.rows,
      start: bounds.start,
      end: bounds.end,
      todayStart: todayBounds.start,
      todayEnd: todayBounds.end,
      now,
    });
  } catch (error) {
    console.error("[notes/analytics] intelligence unavailable", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
