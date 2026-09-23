import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { fetchExistingLabel } from "@/lib/store/shipping/book";

export const dynamic = "force-dynamic";

/**
 * Print a label that already belongs to this shipment.
 * Does not create an order, AWB, or pickup.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const { data: shipment } = await db
    .from("store_shipments")
    .select("provider,awb,label_r2_key,provider_payload")
    .eq("order_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const payload = (shipment?.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as {
    label_url?: string;
  };
  const stored = payload.label_url || shipment?.label_r2_key || null;
  if (!shipment?.awb && !stored) {
    return NextResponse.json({ ok: false, error: "No label is stored for this order." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const provider = shipment?.provider === "shiprocket" || shipment?.provider === "delhivery" ? shipment.provider : "manual";
  const label = await fetchExistingLabel({ provider, awb: shipment?.awb, storedLabelUrl: stored });
  if (!label.url) {
    return NextResponse.json({ ok: false, error: "No label is stored for this order." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ ok: true, url: label.url }, { headers: { "Cache-Control": "no-store" } });
}
