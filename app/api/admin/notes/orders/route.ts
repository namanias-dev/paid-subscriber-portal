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
    .select(
      "id,order_no,status,customer_name,phone,email,total_paise,promised_delivery_date,placed_at,shipping_address_id",
    )
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

  const orders = data || [];
  const addrIds = [...new Set(orders.map((o) => o.shipping_address_id).filter(Boolean))] as string[];
  const addrMap = new Map<
    string,
    { line1: string; line2: string | null; city: string; state: string; pincode: string; landmark: string | null }
  >();
  if (addrIds.length) {
    const { data: addrs } = await db
      .from("store_addresses")
      .select("id,line1,line2,city,state,pincode,landmark")
      .in("id", addrIds);
    for (const a of addrs || []) {
      addrMap.set(a.id, {
        line1: a.line1,
        line2: a.line2,
        city: a.city,
        state: a.state,
        pincode: a.pincode,
        landmark: a.landmark,
      });
    }
  }

  const { data: itemRows } = orders.length
    ? await db
        .from("store_order_items")
        .select("order_id,name_snapshot,qty,sku_snapshot")
        .in(
          "order_id",
          orders.map((o) => o.id),
        )
    : { data: [] as Array<{ order_id: string; name_snapshot: string; qty: number; sku_snapshot: string }> };

  const itemsByOrder = new Map<string, Array<{ name: string; qty: number; sku: string }>>();
  for (const it of itemRows || []) {
    const list = itemsByOrder.get(it.order_id) || [];
    list.push({ name: it.name_snapshot, qty: it.qty, sku: it.sku_snapshot });
    itemsByOrder.set(it.order_id, list);
  }

  return NextResponse.json(
    {
      ok: true,
      orders: orders.map((o) => ({
        ...o,
        address: o.shipping_address_id ? addrMap.get(o.shipping_address_id) || null : null,
        items: itemsByOrder.get(o.id) || [],
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
