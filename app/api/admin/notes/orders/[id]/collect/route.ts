import { NextResponse } from "next/server";
import { requireFreshPermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { commitReservations } from "@/lib/store/inventory";
import { markCollected } from "@/lib/store/collection";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Hand an Academy Pickup order to the customer: READY_FOR_COLLECTION → COLLECTED.
 * Staff must confirm explicitly; the transition itself is in lib/store/collection.ts.
 * The creation flag is not consulted: existing pickup orders stay operable when it is off.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requireFreshPermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "COLLECTED") {
    return NextResponse.json({ ok: false, error: "Confirm the handover first." }, { status: 400, headers: NO_STORE });
  }
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: NO_STORE });
  const result = await markCollected(db, params.id, actor, {
    commitStock: (orderId) => commitReservations(orderId),
    onCollected: (order) => {
      void import("@/lib/store/notifications")
        .then((m) => m.notifyCollected({ orderId: order.id, orderNo: order.order_no }))
        .catch(() => {});
    },
  });
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "WRITE_FAILED" ? 400 : 409;
    return NextResponse.json({ ok: false, error: result.error, status: result.status, already: result.code === "ALREADY_COLLECTED" }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, status: "COLLECTED", collected_at: result.at }, { headers: NO_STORE });
}
