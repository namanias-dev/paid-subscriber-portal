import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { findShiprocketOrder, readShiprocketOrderPublic } from "@/lib/store/shipping/book";
import { shiprocketToken } from "@/lib/store/shipping/shiprocketApi";
import { shiprocketBaseUrl, shippingWritesAuthorized } from "@/lib/store/shipping/config";

export const dynamic = "force-dynamic";

/** Read-only Shiprocket search. Does not create an order, AWB, or pickup. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const { data: order } = await db.from("store_orders").select("order_no").eq("id", params.id).maybeSingle();
  if (!order?.order_no) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const { data: shipment } = await db
    .from("store_shipments")
    .select("provider_shipment_id,provider_payload,awb,status")
    .eq("order_id", params.id)
    .eq("provider", "shiprocket")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  try {
    const found = await findShiprocketOrder(order.order_no);
    const payload = (shipment?.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as {
      provider_order_id?: string;
    };
    const detail = payload.provider_order_id ? await readShiprocketOrderPublic(payload.provider_order_id) : null;
    return NextResponse.json(
      {
        ok: true,
        order_no: order.order_no,
        ...found,
        stored_awb: shipment?.awb || null,
        stored_status: shipment?.status || null,
        detail,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Shiprocket lookup failed.";
    return NextResponse.json({ ok: false, error: message.slice(0, 180) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

/** Assign courier 51 once when the provider order exists and has no AWB. Does not create another order. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (!shippingWritesAuthorized()) {
    return NextResponse.json({ ok: false, error: "Live shipping is not enabled.", writes_authorized: false }, { status: 409 });
  }
  const body = (await req.json().catch(() => null)) as { courier_id?: string } | null;
  if (body?.courier_id !== "51") {
    return NextResponse.json({ ok: false, error: "This assignment is only for courier 51." }, { status: 400 });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const { data: shipment } = await db
    .from("store_shipments")
    .select("id,awb,provider_shipment_id,provider_payload,status")
    .eq("order_id", params.id)
    .eq("provider", "shiprocket")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!shipment?.provider_shipment_id) {
    return NextResponse.json({ ok: false, error: "No pending Shiprocket shipment is waiting for an AWB." }, { status: 409 });
  }
  if (shipment.awb) {
    return NextResponse.json({ ok: true, awb: shipment.awb, already: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const token = await shiprocketToken();
  const assignRes = await fetch(`${shiprocketBaseUrl()}/courier/assign/awb`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ shipment_id: shipment.provider_shipment_id, courier_id: "51" }),
    signal: AbortSignal.timeout(20_000),
  });
  const assigned = await assignRes.json().catch(() => null);
  const data = assigned?.response?.data || assigned?.response || assigned;
  const awb = String(data?.awb_code || data?.awb || "").trim();
  const courier = String(data?.courier_name || "").trim() || null;
  if (!assignRes.ok || !awb) {
    const message = String(assigned?.message || data?.awb_assign_error || "AWB was not assigned.").slice(0, 180);
    return NextResponse.json({ ok: false, error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  const payload = (shipment.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as Record<string, unknown>;
  await db
    .from("store_shipments")
    .update({
      awb,
      courier_name: courier || "Xpressbees Surface",
      status: "created",
      provider_payload: { ...payload, courier_id: "51" },
      updated_at: new Date().toISOString(),
    })
    .eq("id", shipment.id);
  return NextResponse.json({ ok: true, awb, courier: courier || "Xpressbees Surface" }, { headers: { "Cache-Control": "no-store" } });
}
