import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { computePreparationDemand } from "@/lib/store/preparation";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function countIn(db: NonNullable<ReturnType<typeof storeDb>>, statuses: string[]): Promise<number> {
  const { count } = await db.from("store_orders").select("id", { count: "exact", head: true }).in("status", statuses);
  return count ?? 0;
}

/** Action-required snapshot for the Notes Store admin landing (spec §19). */
export async function GET() {
  if (!(await requirePermission("store_manage_orders"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);

  const todayIstStart = new Date();
  // Start of day in IST expressed as UTC ISO.
  const istMidnight = new Date(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(todayIstStart) + "T00:00:00+05:30",
  ).toISOString();

  const [awaitingPrep, readyToShip, inTransit, problems, prep] = await Promise.all([
    countIn(db, ["PAYMENT_CONFIRMED", "ORDER_CONFIRMED", "PROCESSING", "PRINTING", "QUALITY_CHECK", "READY_TO_PACK"]),
    countIn(db, ["PACKED", "READY_FOR_PICKUP", "PICKUP_SCHEDULED"]),
    countIn(db, ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"]),
    countIn(db, ["DELIVERY_FAILED", "REATTEMPT_REQUESTED", "RTO_INITIATED", "RTO_IN_TRANSIT", "RETURN_REQUESTED"]),
    computePreparationDemand(),
  ]);

  const { count: ordersToday } = await db
    .from("store_orders")
    .select("id", { count: "exact", head: true })
    .gte("placed_at", istMidnight);

  // Low / out-of-stock ready_stock products.
  const { data: readyProducts } = await db
    .from("store_products")
    .select("id,name,subject,on_hand,reserved,low_stock_threshold")
    .eq("availability_mode", "ready_stock")
    .eq("is_active", true);
  const lowStock: Array<{ id: string; name: string; subject: string | null; sellable: number }> = [];
  let outOfStock = 0;
  for (const p of readyProducts || []) {
    const sellable = Math.max(0, Number(p.on_hand || 0) - Number(p.reserved || 0));
    if (sellable < 1) outOfStock += 1;
    else if (sellable <= Number(p.low_stock_threshold ?? 5)) lowStock.push({ id: p.id, name: p.name, subject: p.subject, sellable });
  }
  lowStock.sort((a, b) => a.sellable - b.sellable);

  return noStore({
    ok: true,
    cards: {
      orders_today: ordersToday ?? 0,
      awaiting_preparation: awaitingPrep,
      ready_to_ship: readyToShip,
      in_transit: inTransit,
      problems,
      copies_to_prepare: prep.reduce((s, r) => s + r.additional_required, 0),
      low_stock: lowStock.length,
      out_of_stock: outOfStock,
    },
    prepare_top: prep.filter((r) => r.additional_required > 0).slice(0, 6),
    low_stock: lowStock.slice(0, 6),
  });
}
