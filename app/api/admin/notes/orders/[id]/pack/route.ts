import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { shipmentAlreadyActive } from "@/lib/store/shipping/dispatch";
import { assertPackage } from "@/lib/store/shipping/quotes";
import { runAutoFulfillment } from "@/lib/store/shipping/autoFulfillRun";

export const dynamic = "force-dynamic";

/** Save the packed size. Does not call a courier. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as {
    weight_grams?: number;
    length_cm?: number;
    width_cm?: number;
    height_cm?: number;
  } | null;
  const pack = {
    weightGrams: Number(body?.weight_grams),
    lengthCm: Number(body?.length_cm),
    widthCm: Number(body?.width_cm),
    heightCm: Number(body?.height_cm),
  };
  const invalid = assertPackage(pack);
  if (invalid) return NextResponse.json({ ok: false, error: invalid }, { status: 400 });

  const { data: order } = await db.from("store_orders").select("id,status").eq("id", params.id).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const { data: existing } = await db
    .from("store_shipments")
    .select("id,status,awb,provider_payload")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing && shipmentAlreadyActive(existing.status, existing.awb)) {
    return NextResponse.json({ ok: false, error: "This order already has an active shipment." }, { status: 409 });
  }

  const now = new Date().toISOString();
  const row = {
    weight_grams: pack.weightGrams,
    length_mm: Math.round(pack.lengthCm * 10),
    width_mm: Math.round(pack.widthCm * 10),
    height_mm: Math.round(pack.heightCm * 10),
    updated_at: now,
  };
  const payload = { package_source: "STAFF_OVERRIDE" };
  if (existing) {
    const previous = existing && "provider_payload" in existing && existing.provider_payload && typeof existing.provider_payload === "object" ? existing.provider_payload : {};
    await db.from("store_shipments").update({ ...row, provider_payload: { ...previous, ...payload } }).eq("id", existing.id);
  } else {
    await db.from("store_shipments").insert({
      ...row,
      order_id: order.id,
      provider: "manual",
      status: "pending",
      provider_payload: payload,
    });
  }
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "pack_recorded",
    from_status: order.status,
    to_status: order.status,
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: { weight_grams: pack.weightGrams },
  });
  const fulfillment = order.status === "PACKED" || order.status === "READY_FOR_PICKUP"
    ? await runAutoFulfillment(order.id)
    : null;
  return NextResponse.json({ ok: true, fulfillment }, { headers: { "Cache-Control": "no-store" } });
}
