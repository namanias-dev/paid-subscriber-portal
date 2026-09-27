import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { fetchExistingLabel } from "@/lib/store/shipping/book";
import { shiprocketBaseUrl } from "@/lib/store/shipping/config";
import { shiprocketToken } from "@/lib/store/shipping/shiprocketApi";
import { SHIPMENT_ADDRESS_MISMATCH, shipmentHandoffBlocked } from "@/lib/store/address";

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
  const { data: shipmentRows } = await db
    .from("store_shipments")
    .select("id,provider,awb,status,provider_shipment_id,label_r2_key,provider_payload")
    .eq("order_id", params.id)
    .order("created_at", { ascending: false });
  const shipment = (shipmentRows || []).find((row) => row.status !== "cancelled" && row.status !== "failed") || null;
  const payload = (shipment?.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as {
    label_url?: string;
  };
  if (shipmentHandoffBlocked(payload as Record<string, unknown>)) {
    return NextResponse.json(
      { ok: false, error: SHIPMENT_ADDRESS_MISMATCH, code: SHIPMENT_ADDRESS_MISMATCH },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  const stored = payload.label_url || shipment?.label_r2_key || null;
  if (typeof stored === "string" && stored.startsWith("fixture:")) {
    return NextResponse.json(
      { ok: true, fixture: true, url: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!shipment?.awb && !stored) {
    return NextResponse.json({ ok: false, error: "No label is stored for this order." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  let resolved = typeof stored === "string" ? stored : null;
  if ((!resolved || !resolved.startsWith("http")) && shipment?.provider === "shiprocket" && shipment.provider_shipment_id) {
    const token = await shiprocketToken();
    const generated = await fetch(`${shiprocketBaseUrl()}/courier/generate/label`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shipment_id: [shipment.provider_shipment_id] }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await generated.json().catch(() => null);
    const url = typeof body?.label_url === "string" ? body.label_url : "";
    if (url.startsWith("http")) {
      resolved = url;
      const payload = (shipment.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as Record<string, unknown>;
      await db.from("store_shipments").update({ provider_payload: { ...payload, label_url: url }, updated_at: new Date().toISOString() }).eq("id", shipment.id);
    }
  }
  const provider = shipment?.provider === "shiprocket" || shipment?.provider === "delhivery" ? shipment.provider : "manual";
  const label = resolved?.startsWith("http") ? { url: resolved } : await fetchExistingLabel({ provider, awb: shipment?.awb, storedLabelUrl: resolved });
  if (!label.url) {
    return NextResponse.json({ ok: false, error: "No label is stored for this order." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ ok: true, url: label.url }, { headers: { "Cache-Control": "no-store" } });
}
