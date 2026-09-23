import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { computePreparationDemand } from "@/lib/store/preparation";
import { listInterestAggregates } from "@/lib/store/interest";
import { listPreferenceIntelligence } from "@/lib/store/preferences";
import { operationalActions, type OperationalAction } from "@/lib/store/shipping/dispatch";

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

  const actionStatuses = [
    "PACKED",
    "READY_FOR_PICKUP",
    "PICKUP_SCHEDULED",
    "PICKED_UP",
    "IN_TRANSIT",
    "OUT_FOR_DELIVERY",
    "DELIVERY_FAILED",
    "REATTEMPT_REQUESTED",
    "RTO_INITIATED",
    "RTO_IN_TRANSIT",
    "RTO_DELIVERED",
    "RETURN_REQUESTED",
    "REFUND_PENDING",
  ];
  const { data: actionOrders } = await db
    .from("store_orders")
    .select("id,status,promised_delivery_date")
    .in("status", actionStatuses)
    .limit(300);
  const actionIds = (actionOrders || []).map((row) => row.id);
  const shipmentByOrder = new Map<string, Record<string, unknown>>();
  if (actionIds.length) {
    const { data: ships } = await db
      .from("store_shipments")
      .select("order_id,provider,status,awb,created_at,pickup_scheduled_at,picked_up_at,last_synced_at,expected_delivery_date")
      .in("order_id", actionIds);
    for (const ship of ships || []) {
      const current = shipmentByOrder.get(ship.order_id);
      if (!current) shipmentByOrder.set(ship.order_id, ship);
    }
  }
  const nowIso = new Date().toISOString();
  const actionCounts: Record<OperationalAction, number> = {
    awb_missing: 0,
    shipment_failed: 0,
    pickup_overdue: 0,
    tracking_stale: 0,
    delivery_delayed: 0,
    delivery_failed: 0,
    ndr: 0,
    rto: 0,
    return_waiting: 0,
    refund_manual: 0,
  };
  for (const row of actionOrders || []) {
    const ship = shipmentByOrder.get(row.id);
    for (const reason of operationalActions({
      orderStatus: row.status,
      now: nowIso,
      awb: (ship?.awb as string | null) || null,
      provider: (ship?.provider as string | null) || null,
      shipmentStatus: (ship?.status as string | null) || null,
      shipmentCreatedAt: (ship?.created_at as string | null) || null,
      pickupScheduledAt: (ship?.pickup_scheduled_at as string | null) || null,
      pickedUpAt: (ship?.picked_up_at as string | null) || null,
      lastSyncedAt: (ship?.last_synced_at as string | null) || null,
      expectedDeliveryDate: (ship?.expected_delivery_date as string | null) || null,
      promisedDeliveryDate: row.promised_delivery_date,
    })) {
      actionCounts[reason] += 1;
    }
  }

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
    interest_top: (await listInterestAggregates("most"))
      .filter((r) => r.availability_mode === "coming_soon" || r.availability_mode === "unavailable")
      .slice(0, 5),
    action_required: actionCounts,
    preference_top: (await listPreferenceIntelligence()).subjects
      .slice()
      .sort((a, b) => b.raw_count - a.raw_count)
      .filter((s) => s.raw_count > 0)
      .slice(0, 5),
  });
}
