import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { shipmentAlreadyActive } from "@/lib/store/shipping/dispatch";

export const dynamic = "force-dynamic";

/**
 * Remember which courier the team intends to use.
 * Does not create a shipment, AWB, label, or pickup.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as {
    provider?: string;
    courier?: string;
    service?: string;
    courier_id?: string | null;
  } | null;
  const provider = body?.provider === "shiprocket" || body?.provider === "delhivery" ? body.provider : null;
  const courier = String(body?.courier || "").trim();
  if (!provider || !courier) {
    return NextResponse.json({ ok: false, error: "Choose Delhivery or Shiprocket." }, { status: 400 });
  }

  const { data: order } = await db.from("store_orders").select("id,status").eq("id", params.id).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const { data: existing } = await db
    .from("store_shipments")
    .select("id,status,awb")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing && shipmentAlreadyActive(existing.status, existing.awb)) {
    return NextResponse.json({ ok: false, error: "This order already has an active shipment." }, { status: 409 });
  }

  const now = new Date().toISOString();
  const row = {
    provider,
    courier_name: courier,
    courier_id: body?.courier_id || null,
    updated_at: now,
  };
  if (existing) {
    await db.from("store_shipments").update(row).eq("id", existing.id);
  } else {
    await db.from("store_shipments").insert({
      ...row,
      order_id: order.id,
      status: "pending",
    });
  }
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "carrier_selected",
    from_status: order.status,
    to_status: order.status,
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: { provider, courier, service: body?.service || null },
  });
  return NextResponse.json(
    { ok: true, provider, courier, booked: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
