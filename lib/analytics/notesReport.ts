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
  "notes_discount_applied",
  "notes_discount_rejected",
  "notes_discount_removed",
  "notes_discount_payment_reserved",
  "notes_discount_reservation_released",
  "notes_discount_redeemed",
  "notes_purchase_with_discount",
];

export async function loadNotesAnalytics(input: { key: NotesRangeKey; from?: string; to?: string }): Promise<NotesAnalyticsReport> {
  const bounds = notesRangeBounds(input.key, new Date(), { from: input.from, to: input.to });
  const empty = aggregateNotesAnalytics([], [], []);
  const db = getSupabaseAdmin();
  if (!db) return empty;
  const start = bounds.start.toISOString();
  const end = bounds.end.toISOString();
  const events: NotesEventRow[] = [];
  for (let from = 0; from < 8000; from += 1000) {
    const { data } = await db
      .from("analytics_events")
      .select("event_name,session_id,visitor_id,occurred_at,page_path,device,attribution,props,is_bot")
      .in("event_name", EVENT_NAMES)
      .gte("occurred_at", start)
      .lt("occurred_at", end)
      .eq("is_bot", false)
      .order("occurred_at", { ascending: false })
      .range(from, from + 999);
    const rows = (data || []) as NotesEventRow[];
    events.push(...rows);
    if (rows.length < 1000) break;
  }
  const orderSelect = "id,status,total_paise,discount_paise,paid_at,promo_code,attribution_source,attribution_platform,attribution_json,coupon_code,coupon_discount_paise";
  const orderQuery = await db
    .from("store_orders")
    .select(orderSelect)
    .not("paid_at", "is", null)
    .gte("paid_at", start)
    .lt("paid_at", end)
    .limit(2000);
  const orderRows = orderQuery.error
    ? (await db
      .from("store_orders")
      .select("id,status,total_paise,discount_paise,paid_at,promo_code,attribution_source,attribution_platform,attribution_json")
      .not("paid_at", "is", null)
      .gte("paid_at", start)
      .lt("paid_at", end)
      .limit(2000)).data
    : orderQuery.data;
  const orders = (orderRows || []) as NotesOrderFact[];
  const ids = orders.map((order) => order.id);
  let items: NotesItemFact[] = [];
  if (ids.length) {
    const { data: itemRows } = await db
      .from("store_order_items")
      .select("order_id,product_id,name_snapshot,sku_snapshot,line_total_paise")
      .in("order_id", ids);
    items = (itemRows || []) as NotesItemFact[];
  }
  return aggregateNotesAnalytics(events, orders, items);
}
