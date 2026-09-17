import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { commitReservations } from "@/lib/store/inventory";

export const dynamic = "force-dynamic";

/** Manual mark-shipped for Phase 1. AWB is typed in; Shiprocket is Phase 2. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const body = (await req.json()) as { awb?: string; courier_name?: string };
  const awb = (body.awb || "").trim();
  if (!awb) return NextResponse.json({ ok: false, error: "AWB required" }, { status: 400 });

  const { data: order } = await db.from("store_orders").select("id,status").eq("id", params.id).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const now = new Date().toISOString();
  await db.from("store_shipments").insert({
    order_id: order.id,
    provider: "manual",
    awb,
    courier_name: (body.courier_name || "Manual").trim(),
    status: "in_transit",
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
    payload_json: { awb, courier_name: body.courier_name },
  });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
