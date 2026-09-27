import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { requestReverseShipment } from "@/lib/store/shipping/book";
import { dispatchBlocked } from "@/lib/store/shipping/dispatch";

export const dynamic = "force-dynamic";

/**
 * Review a customer report. Reverse pickup is Delhivery-only and still
 * requires the billable write gate. This route does not refund money.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const body = (await req.json().catch(() => null)) as { action?: string; reason?: string } | null;
  const action = body?.action;
  const reason = String(body?.reason || "").trim();
  if (action !== "approve" && action !== "reject" && action !== "replace" && action !== "reverse") {
    return NextResponse.json({ ok: false, error: "Choose a decision." }, { status: 400 });
  }
  if ((action === "reject" || action === "replace" || action === "reverse") && reason.length < 3) {
    return NextResponse.json({ ok: false, error: "Enter a reason." }, { status: 400 });
  }

  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const { data: order } = await db
    .from("store_orders")
    .select("id,status,order_no,total_paise,internal_notes,shipping_address_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const open = order.status === "RETURN_REQUESTED" || order.status === "RETURN_APPROVED";
  if (!open) return NextResponse.json({ ok: false, error: "This order has no open report." }, { status: 409 });

  if (action === "reverse") {
    const blocked = dispatchBlocked();
    if (blocked) {
      return NextResponse.json({ ok: false, error: blocked, writes_authorized: false }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const { data: address } = await db
      .from("store_addresses")
      .select("name,phone,line1,line2,city,state,pincode")
      .eq("id", order.shipping_address_id)
      .maybeSingle();
    const { data: shipment } = await db
      .from("store_shipments")
      .select("weight_grams,length_mm,width_mm,height_mm")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!address?.pincode) return NextResponse.json({ ok: false, error: "The ship-to address is incomplete." }, { status: 400 });
    try {
      const reverse = await requestReverseShipment({
        provider: "delhivery",
        orderNumber: `${order.order_no}-R`,
        name: address.name || "Customer",
        address: [address.line1, address.line2].filter(Boolean).join(", "),
        pin: address.pincode,
        city: address.city || "",
        state: address.state || "",
        phone: address.phone || "",
        product: "Return of printed notes",
        amountRupees: Math.round(Number(order.total_paise) || 0) / 100,
        weightGrams: Number(shipment?.weight_grams) || 800,
        lengthCm: Number(shipment?.length_mm || 300) / 10,
        widthCm: Number(shipment?.width_mm || 220) / 10,
        heightCm: Number(shipment?.height_mm || 30) / 10,
      });
      const now = new Date().toISOString();
      await db.from("store_orders").update({ status: "RETURN_PICKUP_SCHEDULED", updated_at: now }).eq("id", order.id);
      await db.from("store_order_events").insert({
        order_id: order.id,
        event: "reverse_pickup_created",
        from_status: order.status,
        to_status: "RETURN_PICKUP_SCHEDULED",
        actor_type: "admin",
        actor_id: actor?.id,
        actor_name: actor?.name,
        payload_json: { provider: "delhivery", awb_assigned: Boolean(reverse.awb), reason },
      });
      return NextResponse.json({ ok: true, status: "RETURN_PICKUP_SCHEDULED" }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Reverse pickup was not created.";
      return NextResponse.json({ ok: false, error: message.slice(0, 180) }, { status: 502 });
    }
  }

  const next = action === "approve" || action === "replace" ? "RETURN_APPROVED" : order.status;
  const now = new Date().toISOString();
  const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const entry = `${stamp} · ${actor?.name || "admin"}: [${action}] ${reason}`;
  await db
    .from("store_orders")
    .update({ status: next, internal_notes: [order.internal_notes, entry].filter(Boolean).join("\n"), updated_at: now })
    .eq("id", order.id);
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: action === "approve" ? "return_approved" : action === "replace" ? "replacement_recorded" : "return_rejected",
    from_status: order.status,
    to_status: next,
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: { reason: reason || null, shipment: "not_created", gateway: "not_called" },
  });
  return NextResponse.json({ ok: true, status: next, gateway: "not_called" }, { headers: { "Cache-Control": "no-store" } });
}
