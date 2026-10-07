import { NextResponse } from "next/server";
import { requireFreshPermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { advanceFulfillment } from "@/lib/store/collection";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Advance fulfilment status one step (manual queue), from the method-aware transition
 * matrix. Delivery stops at PACKED (courier work uses /dispatch); Academy Pickup stops at
 * READY_FOR_COLLECTION (handover uses /collect). Shipping still uses /ship.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requireFreshPermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const result = await advanceFulfillment(db, params.id, actor, {
    onReady: (order) => {
      void import("@/lib/store/notifications")
        .then((m) => m.notifyReadyForCollection({ orderId: order.id, orderNo: order.order_no }))
        .catch(() => {});
    },
  });
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "WRITE_FAILED" ? 400 : 409;
    return NextResponse.json({ ok: false, error: result.error }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, status: result.status, fulfillment: null }, { headers: NO_STORE });
}
