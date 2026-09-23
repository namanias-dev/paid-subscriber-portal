import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { createProviderShipment } from "@/lib/store/shipping/book";
import { dispatchBlocked, shipmentAlreadyActive } from "@/lib/store/shipping/dispatch";
import { assertPackage } from "@/lib/store/shipping/quotes";
import { canAdvanceOrder } from "@/lib/store/shipping/status";

export const dynamic = "force-dynamic";

const BOOKABLE = new Set(["PACKED", "READY_FOR_PICKUP"]);

/**
 * Book a courier shipment only when billable writes are authorized.
 * Does not record a handover and does not mark the order picked up.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const blocked = dispatchBlocked();
  if (blocked) {
    return NextResponse.json({ ok: false, error: blocked, writes_authorized: false }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  const body = (await req.json().catch(() => null)) as { provider?: string; courier_id?: string } | null;
  const provider = body?.provider === "shiprocket" || body?.provider === "delhivery" ? body.provider : null;
  if (!provider) {
    return NextResponse.json({ ok: false, error: "Choose Delhivery or Shiprocket." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const { data: order } = await db
    .from("store_orders")
    .select("id,status,order_no,total_paise,shipping_address_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (!BOOKABLE.has(order.status)) {
    return NextResponse.json({ ok: false, error: "Pack the order before creating a shipment." }, { status: 409 });
  }

  const { data: shipment } = await db
    .from("store_shipments")
    .select("id,status,awb,weight_grams,length_mm,width_mm,height_mm")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (shipment && shipmentAlreadyActive(shipment.status, shipment.awb)) {
    return NextResponse.json({ ok: false, error: "This order already has an active shipment." }, { status: 409 });
  }
  const pack = {
    weightGrams: Number(shipment?.weight_grams),
    lengthCm: Number(shipment?.length_mm) / 10,
    widthCm: Number(shipment?.width_mm) / 10,
    heightCm: Number(shipment?.height_mm) / 10,
  };
  const invalid = assertPackage(pack);
  if (invalid) return NextResponse.json({ ok: false, error: "Save the packed weight and dimensions first." }, { status: 400 });

  const { data: address } = await db
    .from("store_addresses")
    .select("name,phone,line1,line2,city,state,pincode")
    .eq("id", order.shipping_address_id)
    .maybeSingle();
  if (!address?.pincode || !address.line1) {
    return NextResponse.json({ ok: false, error: "The ship-to address is incomplete." }, { status: 400 });
  }
  const { data: items } = await db.from("store_order_items").select("name_snapshot").eq("order_id", order.id).limit(4);
  const product = (items || []).map((it) => it.name_snapshot).filter(Boolean).join(", ").slice(0, 120) || "Printed notes";

  let created;
  try {
    created = await createProviderShipment({
      provider,
      courierId: body?.courier_id || null,
      orderNumber: order.order_no,
      name: address.name || "Customer",
      address: [address.line1, address.line2].filter(Boolean).join(", "),
      pin: address.pincode,
      city: address.city || "",
      state: address.state || "",
      phone: address.phone || "",
      product,
      amountRupees: Math.round(Number(order.total_paise) || 0) / 100,
      weightGrams: pack.weightGrams,
      lengthCm: pack.lengthCm,
      widthCm: pack.widthCm,
      heightCm: pack.heightCm,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Shipment was not created.";
    return NextResponse.json({ ok: false, error: message.slice(0, 180) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const now = new Date().toISOString();
  const row = {
    provider: created.provider,
    provider_shipment_id: created.providerShipmentId,
    courier_name: created.courierName,
    awb: created.awb,
    status: created.awb ? "created" : "pending",
    provider_payload: { label_url: created.labelUrl, provider_order_id: created.providerOrderId },
    updated_at: now,
  };
  if (shipment) await db.from("store_shipments").update(row).eq("id", shipment.id);
  else {
    await db.from("store_shipments").insert({
      ...row,
      order_id: order.id,
      weight_grams: pack.weightGrams,
      length_mm: Math.round(pack.lengthCm * 10),
      width_mm: Math.round(pack.widthCm * 10),
      height_mm: Math.round(pack.heightCm * 10),
    });
  }

  let orderStatus = order.status;
  if (created.orderStatus && canAdvanceOrder(order.status, created.orderStatus)) {
    orderStatus = created.orderStatus;
    await db.from("store_orders").update({ status: orderStatus, updated_at: now }).eq("id", order.id);
  }
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "shipment_created",
    from_status: order.status,
    to_status: orderStatus,
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: { provider: created.provider, awb_assigned: Boolean(created.awb) },
  });

  return NextResponse.json(
    {
      ok: true,
      provider: created.provider,
      awb: created.awb,
      label_url: created.labelUrl,
      order_status: orderStatus,
      writes_authorized: true,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
