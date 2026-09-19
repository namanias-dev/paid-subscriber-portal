import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";

export const dynamic = "force-dynamic";

const ADVANCE: Record<string, string> = {
  ORDER_CONFIRMED: "PROCESSING",
  PAYMENT_CONFIRMED: "PROCESSING",
  PROCESSING: "PRINTING",
  PRINTING: "QUALITY_CHECK",
  QUALITY_CHECK: "READY_TO_PACK",
  READY_TO_PACK: "PACKED",
};

/** Advance fulfilment status one step (manual queue). Shipping still uses /ship. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const { data: order } = await db.from("store_orders").select("id,status").eq("id", params.id).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const next = ADVANCE[order.status];
  if (!next) {
    return NextResponse.json(
      { ok: false, error: `Cannot advance from ${order.status}. Use Ship with an AWB when ready.` },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = new Date().toISOString();
  const { error } = await db.from("store_orders").update({ status: next, updated_at: now }).eq("id", order.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "status_advanced",
    from_status: order.status,
    to_status: next,
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
  });

  return NextResponse.json({ ok: true, status: next }, { headers: { "Cache-Control": "no-store" } });
}
