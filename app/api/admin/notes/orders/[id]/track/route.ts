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
  const { data: shipment } = await db
    .from("store_shipments")
    .select("provider,awb")
    .eq("order_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!shipment?.awb) {
    return NextResponse.json({ ok: false, error: "No AWB is stored for this order." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const raw =
    shipment.provider === "delhivery"
      ? await trackDelhiveryAwb(shipment.awb)
      : shipment.provider === "shiprocket"
        ? await trackShiprocketAwb(shipment.awb)
        : { rawStatus: null };
  return NextResponse.json(
    { ok: true, raw_status: raw.rawStatus, mapped_status: raw.rawStatus ? normalizeCourierStatus(raw.rawStatus) : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
