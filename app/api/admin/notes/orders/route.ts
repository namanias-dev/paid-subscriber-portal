import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const { data } = await db
    .from("store_orders")
    .select("id,order_no,status,customer_name,phone,total_paise,promised_delivery_date,placed_at")
    .in("status", [
      "PAYMENT_CONFIRMED",
      "ORDER_CONFIRMED",
      "PROCESSING",
      "PRINTING",
      "QUALITY_CHECK",
      "READY_TO_PACK",
      "PACKED",
      "READY_FOR_PICKUP",
    ])
    .order("placed_at", { ascending: true })
    .limit(200);
  return NextResponse.json(
    { ok: true, orders: data || [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
