import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { commitReservations } from "@/lib/store/inventory";
import { selectShippingProvider } from "@/lib/store/shipping";
import { notifyOrderShipped } from "@/lib/store/notifications";

export const dynamic = "force-dynamic";

/**
 * Mark shipped via the active shipping provider (manual today; pluggable later).
 * The manual provider records the typed courier/AWB; an automated provider would
 * create the shipment and return the AWB. Fulfilment is never blocked by a
 * missing aggregator — manual is always available.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const body = (await req.json()) as { awb?: string; courier_name?: string; tracking_url?: string };

  const { data: order } = await db.from("store_orders").select("id,status,order_no").eq("id", params.id).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  let shipment;
  try {
    const provider = await selectShippingProvider();
    shipment = await provider.createShipment({
      orderId: order.id,
      awb: body.awb,
      courierName: body.courier_name,
      trackingUrl: body.tracking_url,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const now = new Date().toISOString();
  await db.from("store_shipments").insert({
    order_id: order.id,
    provider: shipment.provider,
    awb: shipment.awb,
    courier_name: shipment.courierName,
    tracking_url: shipment.trackingUrl,
    status: shipment.status,
  });
  await db
    .from("store_orders")
    .update({ status: "IN_TRANSIT", shipped_at: now, updated_at: now })
    .eq("id", order.id);
  await commitReservations(order.id);
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "marked_shipped",
    from_status: order.status,
    to_status: "IN_TRANSIT",
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: { awb: shipment.awb, courier_name: shipment.courierName, provider: shipment.provider },
  });

  // Fire-and-forget shipped notification (no-op until DLT approved + flag on).
  void notifyOrderShipped({ orderId: order.id, orderNo: order.order_no, awb: shipment.awb, courier: shipment.courierName });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
