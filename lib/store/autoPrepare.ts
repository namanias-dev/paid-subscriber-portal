import { storeDb } from "@/lib/store/db";
import { AUTO_PREPARE_AFTER_MS, NEW_FULFILLMENT_STATUSES } from "@/lib/store/opsBoard";

/**
 * Move paid New orders to Preparing after five minutes.
 * Conditional on the current status so a second run, or a manual advance, cannot skip a stage.
 */
export async function autoPreparePaidOrders(now = new Date()): Promise<{ scanned: number; advanced: number }> {
  const db = storeDb();
  if (!db) return { scanned: 0, advanced: 0 };
  const cutoff = new Date(now.getTime() - AUTO_PREPARE_AFTER_MS).toISOString();
  const { data, error } = await db
    .from("store_orders")
    .select("id,status,paid_at")
    .in("status", [...NEW_FULFILLMENT_STATUSES])
    .not("paid_at", "is", null)
    .lte("paid_at", cutoff)
    .limit(100);
  if (error || !data?.length) return { scanned: 0, advanced: 0 };

  let advanced = 0;
  for (const order of data) {
    if (!order.paid_at || !(NEW_FULFILLMENT_STATUSES as readonly string[]).includes(order.status)) continue;
    const { data: updated, error: updateError } = await db
      .from("store_orders")
      .update({ status: "PROCESSING", updated_at: now.toISOString() })
      .eq("id", order.id)
      .eq("status", order.status)
      .select("id");
    if (updateError || !updated?.length) continue;
    advanced += 1;
    await db.from("store_order_events").insert({
      order_id: order.id,
      event: "status_advanced",
      from_status: order.status,
      to_status: "PROCESSING",
      actor_type: "system",
      actor_name: "Auto prepare",
    });
  }
  return { scanned: data.length, advanced };
}
