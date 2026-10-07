import { NextResponse } from "next/server";
import { requireStoreOrderRead } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { liveShipment, savedCourierRatePaise } from "@/lib/store/orderOps";
import { QUOTE_HISTORY_STARTED, loadHistory, sessionViews } from "@/lib/store/shipping/quoteHistory";

export const dynamic = "force-dynamic";

/**
 * Courier price history for one order. Read-only, staff only.
 * Orders booked before history recording began get their booked courier and rate,
 * and an explicit "not recorded" state. Nothing is reconstructed.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requireStoreOrderRead())) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const [history, ships] = await Promise.all([
    loadHistory(db, params.id),
    db.from("store_shipments").select("id,status,awb,courier_name,provider,provider_payload,created_at").eq("order_id", params.id).order("created_at", { ascending: false }),
  ]);
  if (!history) {
    return NextResponse.json({ ok: false, error: "Courier price history is unavailable right now." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const live = liveShipment(ships.data || []);
  return NextResponse.json(
    {
      ok: true,
      history_started: QUOTE_HISTORY_STARTED,
      sessions: sessionViews(history.sessions, history.options, history.attempts, new Date()),
      current_shipment: live
        ? {
            id: live.id,
            courier: live.courier_name,
            provider: live.provider,
            awb: live.awb,
            status: live.status,
            booked_rate_paise: savedCourierRatePaise(live.provider_payload),
          }
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
