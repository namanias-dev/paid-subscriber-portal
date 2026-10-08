import { NextResponse } from "next/server";
import { storeDb } from "@/lib/store/db";
import { trackDelhiveryAwb } from "@/lib/store/shipping/delhiveryApi";
import { isPickupException, shouldPollShipment, type TrackingSnapshot } from "@/lib/store/shipping/reconcile";
import { trackShiprocketAwb } from "@/lib/store/shipping/shiprocketApi";
import { canAdvanceOrder, canAdvanceShipment, normalizeCourierStatus, orderStatusFromShipment } from "@/lib/store/shipping/status";
import { isInactiveShipmentStatus } from "@/lib/store/shipping/activeShipment";
import { makeSupabasePickupIO, planRetiredShipmentOrder, reconcilePickupFromProvider, toCourierProvider } from "@/lib/store/shipping/refreshPickup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OPEN_STATUSES = [
  "pending",
  "created",
  "failed",
  "manifested",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivery_failed",
  "rto",
];

/**
 * Webhook-first tracking read for shipments that are still open.
 * Delivered shipments are not selected. This route does not create a shipment,
 * buy a label, or request a pickup.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const nowIso = new Date().toISOString();
  const { data: rows, error } = await db
    .from("store_shipments")
    .select("id,order_id,provider,awb,status,pickup_state,created_at,pickup_scheduled_at,picked_up_at,last_synced_at,expected_delivery_date,provider_payload")
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: true })
    .limit(40);
  if (error) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  let considered = 0;
  let polled = 0;
  let advanced = 0;
  let pickupSynced = 0;
  let errors = 0;
  for (const row of rows || []) {
    try {
    const snapshot: TrackingSnapshot = {
      status: row.status,
      provider: row.provider,
      awb: row.awb,
      createdAt: row.created_at,
      now: nowIso,
      pickupScheduledAt: row.pickup_scheduled_at,
      pickedUpAt: row.picked_up_at,
      lastSyncedAt: row.last_synced_at,
      expectedDeliveryDate: row.expected_delivery_date,
      pickupException: isPickupException(String((row.provider_payload as { tracking_activity?: string } | null)?.tracking_activity || "")),
    };
    if (!shouldPollShipment(snapshot)) continue;
    considered += 1;
    const raw =
      row.provider === "delhivery"
        ? await trackDelhiveryAwb(row.awb)
        : await trackShiprocketAwb(row.awb);
    polled += 1;
    const mapped = raw.rawStatus ? normalizeCourierStatus(raw.rawStatus) : null;
    const payload = (row.provider_payload && typeof row.provider_payload === "object" ? row.provider_payload : {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {
      last_synced_at: nowIso,
      updated_at: nowIso,
      provider_payload: {
        ...payload,
        ...(raw.rawStatus ? { tracking_status: raw.rawStatus } : {}),
        ...("activity" in raw && raw.activity ? { tracking_activity: raw.activity } : {}),
        ...("eventTime" in raw && raw.eventTime ? { tracking_event_at: raw.eventTime } : {}),
        ...("location" in raw && raw.location ? { tracking_location: raw.location } : {}),
      },
    };
    if (mapped && canAdvanceShipment(row.status, mapped)) {
      patch.status = mapped;
      if (mapped === "picked_up") patch.picked_up_at = nowIso;
      if (mapped === "delivered") patch.delivered_at = nowIso;
      advanced += 1;
    }
    await db.from("store_shipments").update(patch).eq("id", row.id);

    const nextOrder = mapped ? orderStatusFromShipment(mapped) : null;
    if (nextOrder && mapped && canAdvanceShipment(row.status, mapped)) {
      const { data: order } = await db.from("store_orders").select("id,status,shipped_at").eq("id", row.order_id).maybeSingle();
      if (order && canAdvanceOrder(order.status, nextOrder)) {
        const orderPatch: Record<string, unknown> = { status: nextOrder, updated_at: nowIso };
        if ((nextOrder === "PICKED_UP" || nextOrder === "IN_TRANSIT") && !order.shipped_at) orderPatch.shipped_at = nowIso;
        if (nextOrder === "DELIVERED") orderPatch.delivered_at = nowIso;
        await db.from("store_orders").update(orderPatch).eq("id", order.id);
        await db.from("store_order_events").insert({
          order_id: order.id,
          event: "courier_poll",
          from_status: order.status,
          to_status: nextOrder,
          actor_type: "system",
          actor_name: row.provider,
          payload_json: { awb: row.awb },
        });
      }
    }

    // Pickup lifecycle reconcile: learn provider-side pickup cancellation / scheduling that
    // the shipment-status machine above cannot express (§3, §4, §5, §12). Reads the order
    // fresh so it respects any advance just applied; the reconciler never regresses after
    // possession and is idempotent for repeated/duplicate polls.
    if (raw.rawStatus && row.awb && (row.provider === "delhivery" || row.provider === "shiprocket")) {
      const { data: porder } = await db.from("store_orders").select("id,status,fulfillment_method").eq("id", row.order_id).maybeSingle();
      if (porder && porder.fulfillment_method === "DELIVERY") {
        const shipStatus = (patch.status as string | undefined) ?? row.status;
        const io = makeSupabasePickupIO(db, porder.id);
        const outcome = await reconcilePickupFromProvider(
          { id: porder.id, status: porder.status },
          {
            id: row.id,
            provider: toCourierProvider(row.provider),
            awb: row.awb,
            shipmentStatus: shipStatus,
            trackingStatus: raw.rawStatus,
            pickupStatusRaw: raw.rawStatus,
            pickupState: (row.pickup_state as never) ?? "NOT_REQUESTED",
            // Keep the pre-update flag. Marking the row cancelled above must not
            // hide the Case B order transition from the reconciler.
            active: !isInactiveShipmentStatus(row.status),
          },
          raw.rawStatus,
          "activity" in raw ? ((raw.activity as string | null) ?? null) : null,
          { name: row.provider },
          io,
          "RECONCILIATION",
        );
        if (outcome.changed) pickupSynced += 1;
      }
    }
    } catch {
      errors += 1;
    }
  }

  // Orders whose only AWB was already retired, but the order never left the pickup stage.
  // Local only: no provider read and no new shipment.
  let retiredOrders = 0;
  const { data: pickupOrders } = await db
    .from("store_orders")
    .select("id,status")
    .eq("fulfillment_method", "DELIVERY")
    .in("status", ["PICKUP_SCHEDULED", "READY_FOR_PICKUP"])
    .order("updated_at", { ascending: false })
    .limit(40);
  for (const order of pickupOrders || []) {
    const { data: ships } = await db.from("store_shipments").select("status,awb").eq("order_id", order.id);
    const next = planRetiredShipmentOrder({ orderStatus: order.status, rows: ships || [] });
    if (!next) continue;
    const { data: moved } = await db
      .from("store_orders")
      .update({ status: next, updated_at: nowIso })
      .eq("id", order.id)
      .eq("status", order.status)
      .select("id");
    if (!Array.isArray(moved) || moved.length === 0) continue;
    await db.from("store_order_events").insert({
      order_id: order.id,
      event: "courier_pickup_synced",
      from_status: order.status,
      to_status: next,
      actor_type: "system",
      actor_name: "reconciliation",
      payload_json: { basis: "shipment_cancelled", cancel_shipment: false, source: "RECONCILIATION", reason: "retired_shipment_no_active_awb" },
    });
    retiredOrders += 1;
  }

  return NextResponse.json({ ok: true, considered, polled, advanced, pickupSynced, retiredOrders, errors, ts: Date.now() });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
