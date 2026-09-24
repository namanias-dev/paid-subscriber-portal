import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { findShiprocketOrder } from "@/lib/store/shipping/book";

export const dynamic = "force-dynamic";

/** Read-only Shiprocket search. Does not create an order, AWB, or pickup. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const { data: order } = await db.from("store_orders").select("order_no").eq("id", params.id).maybeSingle();
  if (!order?.order_no) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const found = await findShiprocketOrder(order.order_no);
    return NextResponse.json({ ok: true, order_no: order.order_no, ...found }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Shiprocket lookup failed.";
    return NextResponse.json({ ok: false, error: message.slice(0, 180) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
