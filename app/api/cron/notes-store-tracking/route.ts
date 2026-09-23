import { NextResponse } from "next/server";
import { storeDb } from "@/lib/store/db";
import { trackDelhiveryAwb } from "@/lib/store/shipping/delhiveryApi";
import { shouldPollShipment, type TrackingSnapshot } from "@/lib/store/shipping/reconcile";
import { trackShiprocketAwb } from "@/lib/store/shipping/shiprocketApi";
import { canAdvanceOrder, canAdvanceShipment, normalizeCourierStatus, orderStatusFromShipment } from "@/lib/store/shipping/status";

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
    .select("id,order_id,provider,awb,status,created_at,pickup_scheduled_at,picked_up_at,last_synced_at,expected_delivery_date")
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: true })
    .limit(40);
  if (error) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  let considered = 0;
  let polled = 0;
  let advanced = 0;
  for (const row of rows || []) {
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
    };
    if (!shouldPollShipment(snapshot)) continue;
    considered += 1;
    const raw =
      row.provider === "delhivery"
        ? await trackDelhiveryAwb(row.awb)
        : await trackShiprocketAwb(row.awb);
    polled += 1;
    const mapped = raw.rawStatus ? normalizeCourierStatus(raw.rawStatus) : null;
    const patch: Record<string, unknown> = { last_synced_at: nowIso, updated_at: nowIso };
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
  }

  return NextResponse.json({ ok: true, considered, polled, advanced, ts: Date.now() });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
