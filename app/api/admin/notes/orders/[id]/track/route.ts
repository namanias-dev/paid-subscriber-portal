import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { trackDelhiveryAwb } from "@/lib/store/shipping/delhiveryApi";
import { normalizeCourierStatus } from "@/lib/store/shipping/status";
import { trackShiprocketAwb } from "@/lib/store/shipping/shiprocketApi";

export const dynamic = "force-dynamic";

/** Read the latest carrier scan. Does not change the order. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const { data: shipmentRows } = await db
    .from("store_shipments")
    .select("provider,awb,status")
    .eq("order_id", params.id)
    .order("created_at", { ascending: false });
  const shipment = (shipmentRows || []).find((row) => row.status !== "cancelled" && row.status !== "failed") || null;
  if (!shipment?.awb) {
    return NextResponse.json({ ok: false, error: "No AWB is stored for this order." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const tracked =
    shipment.provider === "delhivery"
      ? await trackDelhiveryAwb(shipment.awb)
      : shipment.provider === "shiprocket"
        ? await trackShiprocketAwb(shipment.awb)
        : { rawStatus: null, recognized: false, courier: null, error: null, eventTime: null, location: null, activity: null };
  const raw = tracked;
  const recognized = "recognized" in tracked ? tracked.recognized : Boolean(raw.rawStatus);
  const courier = "courier" in tracked ? tracked.courier : null;
  const error = "error" in tracked ? tracked.error : null;
  if (raw.rawStatus) {
    const { data: current } = await db
      .from("store_shipments")
      .select("id,provider_payload")
      .eq("order_id", params.id)
      .eq("awb", shipment.awb)
      .limit(1)
      .maybeSingle();
    const payload = (current?.provider_payload && typeof current.provider_payload === "object" ? current.provider_payload : {}) as Record<string, unknown>;
    if (current?.id) {
      await db
        .from("store_shipments")
        .update({
          provider_payload: {
            ...payload,
            tracking_status: raw.rawStatus,
            tracking_courier: courier,
            tracking_activity: "activity" in tracked ? tracked.activity : null,
            tracking_event_at: "eventTime" in tracked ? tracked.eventTime : null,
            tracking_location: "location" in tracked ? tracked.location : null,
          },
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id);
    }
  }
  return NextResponse.json(
    {
      ok: !error,
      raw_status: raw.rawStatus,
      mapped_status: raw.rawStatus ? normalizeCourierStatus(raw.rawStatus) : null,
      recognized,
      courier,
      error,
      event_time: "eventTime" in tracked ? tracked.eventTime : null,
      location: "location" in tracked ? tracked.location : null,
      activity: "activity" in tracked ? tracked.activity : null,
      activities: "activities" in tracked ? tracked.activities : [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
