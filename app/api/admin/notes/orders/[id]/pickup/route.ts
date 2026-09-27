import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { requestProviderPickup } from "@/lib/store/shipping/book";
import { dispatchBlocked } from "@/lib/store/shipping/dispatch";
import { canAdvanceOrder } from "@/lib/store/shipping/status";
import { SHIPMENT_ADDRESS_MISMATCH, shipmentHandoffBlocked } from "@/lib/store/address";

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
  const body = (await req.json().catch(() => null)) as { date?: string; reattempt?: boolean } | null;
  const date = String(body?.date || "").trim();
  const reattempt = body?.reattempt === true;
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const { data: order } = await db.from("store_orders").select("id,status").eq("id", params.id).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const { data: shipmentRows } = await db
    .from("store_shipments")
    .select("id,provider,provider_shipment_id,awb,status,provider_payload")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false });
  const shipment = (shipmentRows || []).find((row) => row.status !== "cancelled" && row.status !== "failed") || null;
  if (!shipment?.awb || (shipment.provider !== "shiprocket" && shipment.provider !== "delhivery")) {
    return NextResponse.json({ ok: false, error: "Create the courier shipment before scheduling pickup." }, { status: 409 });
  }
  const existingPayload = (shipment.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as Record<string, unknown>;
  if (reattempt && (shipment.provider !== "shiprocket" || !shipment.provider_shipment_id)) {
    return NextResponse.json({ ok: false, error: "This reattempt only applies to the existing Shiprocket shipment." }, { status: 409 });
  }
  if (reattempt && existingPayload.pickup_reattempt_date === date && existingPayload.pickup_status === "reattempt_requested") {
    return NextResponse.json(
      { ok: true, already: true, pickup_date: date, pickup_reference: existingPayload.pickup_reference || null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (shipmentHandoffBlocked(existingPayload)) {
    return NextResponse.json(
      { ok: false, error: SHIPMENT_ADDRESS_MISMATCH, code: SHIPMENT_ADDRESS_MISMATCH },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  let pickup;
  try {
    pickup = await requestProviderPickup({
      provider: shipment.provider,
      providerShipmentId: shipment.provider_shipment_id,
      date,
      retry: reattempt,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Pickup was not scheduled.";
    return NextResponse.json({ ok: false, error: message.slice(0, 180) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const now = new Date().toISOString();
  const payload = (shipment.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as Record<string, unknown>;
  const dateOnly = pickup.date.slice(0, 10);
  const scheduledAt = /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? `${dateOnly}T00:00:00.000Z` : now;
  await db
    .from("store_shipments")
    .update({
      pickup_scheduled_at: scheduledAt,
      provider_payload: {
        ...payload,
        pickup_reference: pickup.reference || payload.pickup_reference,
        pickup_previous_reference: reattempt ? payload.pickup_reference || null : payload.pickup_previous_reference,
        pickup_date: dateOnly,
        pickup_status: reattempt ? "reattempt_requested" : pickup.status || "requested",
        ...(reattempt ? { pickup_reattempt_date: dateOnly } : {}),
        ...(pickup.time ? { pickup_time: pickup.time } : {}),
      },
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
