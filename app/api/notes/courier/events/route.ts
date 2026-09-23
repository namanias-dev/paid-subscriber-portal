import { NextResponse } from "next/server";
import { storeDb } from "@/lib/store/db";
import { courierWebhookKey } from "@/lib/store/shipping/config";
import { canAdvanceOrder, canAdvanceShipment, orderStatusFromShipment } from "@/lib/store/shipping/status";
import { parseCourierWebhook, webhookAuthorized } from "@/lib/store/shipping/webhook";

export const dynamic = "force-dynamic";

/**
 * Courier tracking callback.
 * Shiprocket asks that the URL avoid the words shiprocket, kartrocket, sr, and kr.
 * Authenticate with the x-api-key header (Shiprocket's security token).
 * A scan never buys a label. Delivered does not move backwards.
 */
export async function POST(req: Request) {
  const expected = courierWebhookKey();
  if (!expected) {
    return NextResponse.json({ ok: false, error: "webhook key not configured" }, { status: 503 });
  }
  if (!webhookAuthorized(req.headers.get("x-api-key"), expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const event = parseCourierWebhook(body);
  if (!event) {
    return NextResponse.json({ ok: false, error: "unrecognized payload" }, { status: 400 });
  }

  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const { data: shipment } = await db
    .from("store_shipments")
    .select("id,order_id,status")
    .eq("awb", event.awb)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!shipment) {
    return NextResponse.json({ ok: true, matched: false });
  }

  const { data: prior } = await db
    .from("store_shipment_events")
    .select("payload_json")
    .eq("shipment_id", shipment.id)
    .order("created_at", { ascending: false })
    .limit(40);
  const duplicate = (prior || []).some((row) => {
    const payload = row.payload_json as { dedupe_key?: string } | null;
    return payload?.dedupe_key === event.dedupeKey;
  });
  if (duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  await db.from("store_shipment_events").insert({
    shipment_id: shipment.id,
    provider_status_raw: event.rawStatus,
    mapped_status: event.mappedStatus,
    location: event.location,
    remark: event.remark,
    payload_json: { dedupe_key: event.dedupeKey, provider: event.provider },
  });

  let shipmentUpdated = false;
  if (event.mappedStatus && canAdvanceShipment(shipment.status, event.mappedStatus)) {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status: event.mappedStatus,
      last_synced_at: now,
      updated_at: now,
    };
    if (event.mappedStatus === "picked_up") patch.picked_up_at = now;
    if (event.mappedStatus === "delivered") patch.delivered_at = now;
    await db.from("store_shipments").update(patch).eq("id", shipment.id);
    shipmentUpdated = true;

    const nextOrder = orderStatusFromShipment(event.mappedStatus);
    if (nextOrder) {
      const { data: order } = await db
        .from("store_orders")
        .select("id,status,shipped_at")
        .eq("id", shipment.order_id)
        .maybeSingle();
      if (order && canAdvanceOrder(order.status, nextOrder)) {
        const orderPatch: Record<string, unknown> = { status: nextOrder, updated_at: now };
        if ((nextOrder === "PICKED_UP" || nextOrder === "IN_TRANSIT") && !order.shipped_at) orderPatch.shipped_at = now;
        if (nextOrder === "DELIVERED") orderPatch.delivered_at = now;
        await db.from("store_orders").update(orderPatch).eq("id", order.id);
        await db.from("store_order_events").insert({
          order_id: order.id,
          event: "courier_scan",
          from_status: order.status,
          to_status: nextOrder,
          actor_type: "system",
          actor_name: event.provider,
          payload_json: { awb: event.awb, raw_status: event.rawStatus },
        });
      }
    }
  }

  return NextResponse.json({ ok: true, matched: true, updated: shipmentUpdated });
}
