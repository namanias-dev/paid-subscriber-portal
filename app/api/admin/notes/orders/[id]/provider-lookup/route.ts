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
  if ((body as { action?: string }).action === "address") {
    const { data: current } = await db
      .from("store_shipments")
      .select("id,provider_payload")
      .eq("order_id", params.id)
      .eq("provider", "shiprocket")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const currentPayload = (current?.provider_payload && typeof current.provider_payload === "object" ? current.provider_payload : {}) as Record<string, unknown>;
    const orderId = String(currentPayload.provider_order_id || "");
    const { data: order } = await db.from("store_orders").select("customer_name,phone,shipping_address_id").eq("id", params.id).maybeSingle();
    const { data: address } = order?.shipping_address_id
      ? await db.from("store_addresses").select("name,phone,line1,line2,city,state,pincode").eq("id", order.shipping_address_id).maybeSingle()
      : { data: null };
    if (!orderId || !address || address.pincode !== "134109") {
      return NextResponse.json({ ok: false, error: "Canonical address is not ready." }, { status: 409 });
    }
    const phone = String(address.phone || order?.phone || "");
    const [first, ...rest] = String(address.name || order?.customer_name || "Customer").trim().split(/\s+/);
    const token = await shiprocketToken();
    const updateRes = await fetch(`${shiprocketBaseUrl()}/orders/address/update`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        order_id: Number(orderId),
        shipping_customer_name: first || "Customer",
        shipping_last_name: rest.join(" ") || ".",
        shipping_phone: phone,
        shipping_address: [address.line1, address.line2].filter(Boolean).join(", "),
        shipping_address_2: address.line2 || "",
        shipping_city: address.city,
        shipping_state: address.state,
        shipping_country: "India",
        shipping_pincode: address.pincode,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const checked = await readShiprocketOrderPublic(orderId);
    return NextResponse.json(
      {
        ok: updateRes.ok && checked.pin === "134109" && checked.hasHouse === true && checked.hasLocality === true,
        pin: checked.pin,
        city: checked.city,
        state: checked.state,
        hasHouse: checked.hasHouse,
        hasLocality: checked.hasLocality,
        phoneStored: checked.phoneStored,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
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
  const payload = (shipment.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as Record<string, unknown>;
  const providerOrderId = String(payload.provider_order_id || "");
  const { data: order } = await db
    .from("store_orders")
    .select("customer_name,phone,shipping_address_id")
    .eq("id", params.id)
    .maybeSingle();
  const { data: address } = order?.shipping_address_id
    ? await db.from("store_addresses").select("name,phone,line1,line2,city,state,pincode").eq("id", order.shipping_address_id).maybeSingle()
    : { data: null };
  const phone = String(address?.phone || order?.phone || "");
  const name = String(address?.name || order?.customer_name || "Customer");
  const [first, ...rest] = name.trim().split(/\s+/);
  const token = await shiprocketToken();
  if (providerOrderId && phone.replace(/\D/g, "").length >= 10 && address?.pincode === "134109") {
    const updateRes = await fetch(`${shiprocketBaseUrl()}/orders/address/update`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        order_id: Number(providerOrderId),
        shipping_customer_name: first || "Customer",
        shipping_last_name: rest.join(" ") || ".",
        shipping_phone: phone,
        shipping_address: address.line1,
        shipping_address_2: address.line2 || "",
        shipping_city: address.city,
        shipping_state: address.state,
        shipping_country: "India",
        shipping_pincode: address.pincode,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const updateBody = await updateRes.json().catch(() => null);
    const updateOk = updateRes.ok && updateBody?.success !== false;
    const checked = await readShiprocketOrderPublic(providerOrderId);
    if (checked.pin !== "134109" || checked.city !== "Panchkula" || checked.state !== "Haryana") {
      return NextResponse.json(
        { ok: false, error: "SHIPMENT_ADDRESS_MISMATCH", pin: checked.pin, city: checked.city, state: checked.state },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!checked.phoneStored && !updateOk) {
      return NextResponse.json(
        { ok: false, error: "PHONE_NOT_STORED", pin: checked.pin, city: checked.city, state: checked.state },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
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
  await db
    .from("store_shipments")
    .update({
      awb,
      courier_name: courier || "Xpressbees Surface",
      status: "created",
      provider_payload: { ...payload, courier_id: "51", phone_stored: true, address_mismatch: false, do_not_handoff: false, address_unverified: false },
      updated_at: new Date().toISOString(),
    })
    .eq("id", shipment.id);
  return NextResponse.json({ ok: true, awb, courier: courier || "Xpressbees Surface" }, { headers: { "Cache-Control": "no-store" } });
}
