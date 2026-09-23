import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { requestProviderPickup } from "@/lib/store/shipping/book";
import { dispatchBlocked } from "@/lib/store/shipping/dispatch";
import { canAdvanceOrder } from "@/lib/store/shipping/status";

export const dynamic = "force-dynamic";

/**
 * Ask the courier to collect a parcel that already has a shipment.
 * Does not mark the order shipped. Possession still comes from a carrier scan.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const blocked = dispatchBlocked();
  if (blocked) {
    return NextResponse.json({ ok: false, error: blocked, writes_authorized: false }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const body = (await req.json().catch(() => null)) as { date?: string } | null;
  const date = String(body?.date || "").trim();
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const { data: order } = await db.from("store_orders").select("id,status").eq("id", params.id).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const { data: shipment } = await db
    .from("store_shipments")
    .select("id,provider,provider_shipment_id,awb,provider_payload")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!shipment?.awb || (shipment.provider !== "shiprocket" && shipment.provider !== "delhivery")) {
    return NextResponse.json({ ok: false, error: "Create the courier shipment before scheduling pickup." }, { status: 409 });
  }

  let pickup;
  try {
    pickup = await requestProviderPickup({
      provider: shipment.provider,
      providerShipmentId: shipment.provider_shipment_id,
      date,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Pickup was not scheduled.";
    return NextResponse.json({ ok: false, error: message.slice(0, 180) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const now = new Date().toISOString();
  const payload = (shipment.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as Record<string, unknown>;
  await db
    .from("store_shipments")
    .update({
      pickup_scheduled_at: `${pickup.date}T10:00:00+05:30`,
      provider_payload: { ...payload, pickup_reference: pickup.reference, pickup_date: pickup.date },
      updated_at: now,
    })
    .eq("id", shipment.id);

  let orderStatus = order.status;
  if (canAdvanceOrder(order.status, "PICKUP_SCHEDULED")) {
    orderStatus = "PICKUP_SCHEDULED";
    await db.from("store_orders").update({ status: orderStatus, updated_at: now }).eq("id", order.id);
  }
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "pickup_scheduled",
    from_status: order.status,
    to_status: orderStatus,
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: { provider: shipment.provider, pickup_date: pickup.date, pickup_reference: pickup.reference },
  });

  return NextResponse.json(
    { ok: true, order_status: orderStatus, pickup_date: pickup.date, pickup_reference: pickup.reference },
    { headers: { "Cache-Control": "no-store" } },
  );
}
