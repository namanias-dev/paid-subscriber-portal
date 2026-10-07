/**
 * Staff fulfilment transitions with database-level conditional updates.
 *
 * `advanceFulfillment` moves one step along the method-aware matrix (pickup stops at
 * READY_FOR_COLLECTION). `markCollected` hands an Academy Pickup order over. Only the
 * request that wins the conditional update writes the event, stamps the time, commits
 * stock and fires hooks, so double clicks, retries and two staff members produce
 * exactly one transition. The creation flag is never consulted: existing pickup orders
 * stay operable when it is off.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { canMarkCollected, isAcademyPickup, orderMethod, staffNextStatusFor } from "./fulfillment";

export interface StaffActor {
  id?: string | null;
  name?: string | null;
}

export type TransitionResult =
  | { ok: true; status: string; at: string }
  | { ok: false; code: "NOT_FOUND" | "NO_NEXT" | "CONFLICT" | "NOT_PICKUP" | "NOT_READY" | "ALREADY_COLLECTED" | "WRITE_FAILED"; error: string; status?: string };

export async function advanceFulfillment(
  db: SupabaseClient,
  orderId: string,
  actor: StaffActor | null,
  hooks: { onReady?: (order: { id: string; order_no: string }) => void } = {},
): Promise<TransitionResult> {
  const { data: order } = await db.from("store_orders").select("id,order_no,status,fulfillment_method").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, code: "NOT_FOUND", error: "not found" };
  const method = orderMethod(order);
  const next = staffNextStatusFor(order.status, method);
  if (!next) {
    const error = method === "ACADEMY_PICKUP"
      ? order.status === "READY_FOR_COLLECTION"
        ? "This order is ready. Use Mark collected when the customer collects it."
        : order.status === "COLLECTED"
          ? "This order is already marked collected."
          : "This order cannot move to the next step."
      : "Cannot advance from this status. Courier steps use Compare couriers.";
    return { ok: false, code: "NO_NEXT", error, status: order.status };
  }
  const now = new Date().toISOString();
  const ready = next === "READY_FOR_COLLECTION";
  const { data: updated, error } = await db
    .from("store_orders")
    .update(ready ? { status: next, ready_for_collection_at: now, updated_at: now } : { status: next, updated_at: now })
    .eq("id", order.id)
    .eq("status", order.status)
    .select("id");
  if (error) {
    console.info(`[store/fulfillment] advance_failed ${JSON.stringify({ order_id: order.id, fulfillment_method: method })}`);
    return { ok: false, code: "WRITE_FAILED", error: "This step could not be saved. Refresh and try again." };
  }
  if (!updated?.length) return { ok: false, code: "CONFLICT", error: "This order already moved. Refresh and try the next step." };
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: ready ? "ready_for_collection" : "status_advanced",
    from_status: order.status,
    to_status: next,
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: { fulfillment_method: method },
  });
  if (ready) hooks.onReady?.({ id: order.id, order_no: order.order_no });
  return { ok: true, status: next, at: now };
}

export async function markCollected(
  db: SupabaseClient,
  orderId: string,
  actor: StaffActor | null,
  hooks: { commitStock?: (orderId: string) => Promise<unknown>; onCollected?: (order: { id: string; order_no: string }) => void } = {},
): Promise<TransitionResult> {
  const { data: order } = await db.from("store_orders").select("id,order_no,status,fulfillment_method").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, code: "NOT_FOUND", error: "not found" };
  if (!isAcademyPickup(order)) return { ok: false, code: "NOT_PICKUP", error: "This is a Delivery order. Courier delivery completes it." };
  if (order.status === "COLLECTED") return { ok: false, code: "ALREADY_COLLECTED", error: "This order is already marked collected.", status: "COLLECTED" };
  if (!canMarkCollected(order)) return { ok: false, code: "NOT_READY", error: "This order is not ready for collection yet.", status: order.status };

  const now = new Date().toISOString();
  const { data: updated, error } = await db
    .from("store_orders")
    .update({ status: "COLLECTED", collected_at: now, updated_at: now })
    .eq("id", order.id)
    .eq("status", "READY_FOR_COLLECTION")
    .eq("fulfillment_method", "ACADEMY_PICKUP")
    .select("id");
  if (error) {
    console.info(`[store/fulfillment] collect_failed ${JSON.stringify({ order_id: order.id, fulfillment_method: "ACADEMY_PICKUP" })}`);
    return { ok: false, code: "WRITE_FAILED", error: "The handover could not be saved. Refresh and try again." };
  }
  if (!updated?.length) return { ok: false, code: "CONFLICT", error: "This order already moved. Refresh to see its current status." };
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "collected",
    from_status: "READY_FOR_COLLECTION",
    to_status: "COLLECTED",
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: { fulfillment_method: "ACADEMY_PICKUP" },
  });
  // Ready-stock lines leave custody now, the same moment /ship commits them for delivery.
  // The RPC commits only uncommitted reservations, so a retry cannot double-commit.
  await hooks.commitStock?.(order.id);
  hooks.onCollected?.({ id: order.id, order_no: order.order_no });
  return { ok: true, status: "COLLECTED", at: now };
}
