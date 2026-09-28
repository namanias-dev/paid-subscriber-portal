import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { cancelProviderShipment, createProviderShipment, requestProviderPickup } from "@/lib/store/shipping/book";
import { dispatchBlocked, shipmentAlreadyActive } from "@/lib/store/shipping/dispatch";
import { bookOneCourier, orderStatusAfterBooking } from "@/lib/store/shipping/manualBook";
import { assertPackage } from "@/lib/store/shipping/quotes";
import { resolveAutoPackage } from "@/lib/store/shipping/autoFulfill";

export const dynamic = "force-dynamic";

const BOOKABLE = new Set(["PACKED", "READY_FOR_PICKUP"]);

/**
 * Book a courier shipment only when billable writes are authorized.
 * Does not record a handover and does not mark the order picked up.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const blocked = dispatchBlocked();
  if (blocked) {
    return NextResponse.json({ ok: false, error: blocked, writes_authorized: false }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  const body = (await req.json().catch(() => null)) as {
    provider?: string;
    courier_id?: string;
    service?: string;
    courier?: string;
    confirm?: boolean;
    rate_paise?: number;
  } | null;
  const provider = body?.provider === "shiprocket" || body?.provider === "delhivery" ? body.provider : null;
  if (!provider) {
    return NextResponse.json({ ok: false, error: "Choose Delhivery or Shiprocket." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (body?.confirm !== true) {
    return NextResponse.json({ ok: false, error: "Confirm the courier before booking.", code: "CONFIRM" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const { data: order } = await db
    .from("store_orders")
    .select("id,status,order_no,total_paise,shipping_address_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (!BOOKABLE.has(order.status)) {
    return NextResponse.json({ ok: false, error: "Pack the order before creating a shipment." }, { status: 409 });
  }

  const { data: shipmentRows } = await db
    .from("store_shipments")
    .select("id,status,awb,weight_grams,length_mm,width_mm,height_mm,courier_name")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false });
  const active = (shipmentRows || []).find((row) => row.status !== "cancelled" && row.status !== "failed" && shipmentAlreadyActive(row.status, row.awb));
  if (active) {
    return NextResponse.json({ ok: false, error: "This order already has an active shipment." }, { status: 409 });
  }
  const packed = (shipmentRows || []).find((row) => row.weight_grams && row.length_mm && row.width_mm && row.height_mm) || null;
  let pack = packed
    ? {
        weightGrams: Number(packed.weight_grams),
        lengthCm: Number(packed.length_mm) / 10,
        widthCm: Number(packed.width_mm) / 10,
        heightCm: Number(packed.height_mm) / 10,
      }
    : null;
  if (!pack || assertPackage(pack)) {
    const { data: items } = await db.from("store_order_items").select("qty,weight_grams_snapshot,product_id").eq("order_id", order.id);
    const lines = [];
    for (const item of items || []) {
      const { data: product } = item.product_id
        ? await db.from("store_products").select("weight_grams,length_mm,width_mm,height_mm").eq("id", item.product_id).maybeSingle()
        : { data: null };
      lines.push({
        qty: Number(item.qty) || 1,
        weightGrams: product?.weight_grams || item.weight_grams_snapshot || null,
        lengthMm: product?.length_mm || null,
        widthMm: product?.width_mm || null,
        heightMm: product?.height_mm || null,
      });
    }
    const resolved = resolveAutoPackage(lines);
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: "Save the packed weight and dimensions first." }, { status: 400 });
    }
    pack = resolved;
  }
  const invalid = assertPackage(pack);
  if (invalid) return NextResponse.json({ ok: false, error: invalid }, { status: 400 });

  const { data: address } = await db
    .from("store_addresses")
    .select("name,phone,line1,line2,city,state,pincode")
    .eq("id", order.shipping_address_id)
    .maybeSingle();
  if (!address?.pincode || !address.line1) {
    return NextResponse.json({ ok: false, error: "The ship-to address is incomplete." }, { status: 400 });
  }
  const { data: items } = await db.from("store_order_items").select("name_snapshot").eq("order_id", order.id).limit(4);
  const product = (items || []).map((it) => it.name_snapshot).filter(Boolean).join(", ").slice(0, 120) || "Printed notes";

  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: locked } = await db
    .from("store_orders")
    .update({ fulfillment_lock_at: now, updated_at: now })
    .eq("id", order.id)
    .or(`fulfillment_lock_at.is.null,fulfillment_lock_at.lt.${stale}`)
    .select("id")
    .maybeSingle();
  if (!locked) {
    return NextResponse.json({ ok: false, error: "A booking is already in progress.", code: "ACTIVE" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  const attempt = (shipmentRows || []).length + 1;
  const service = String(body?.service || "");
  const release = async () => {
    await db.from("store_orders").update({ fulfillment_lock_at: null, updated_at: new Date().toISOString() }).eq("id", order.id);
  };

  try {
    const outcome = await bookOneCourier({
      confirm: true,
      alreadyActive: false,
      create: async () => {
        const created = await createProviderShipment({
          provider,
          courierId: body?.courier_id || null,
          orderNumber: `${order.order_no}-M${attempt}`,
          name: address.name || "Customer",
          address: [address.line1, address.line2].filter(Boolean).join(", "),
          pin: address.pincode,
          city: address.city || "",
          state: address.state || "",
          phone: address.phone || "",
          product,
          amountRupees: Math.round(Number(order.total_paise) || 0) / 100,
          weightGrams: pack.weightGrams,
          lengthCm: pack.lengthCm,
          widthCm: pack.widthCm,
          heightCm: pack.heightCm,
          shippingMode: /express/i.test(service) ? "Express" : "Surface",
        });
        return { ...created, pickupReference: null as string | null, pickupStatus: null as string | null, pickupDate: null as string | null };
      },
      cancel: async (created) => {
        try {
          await cancelProviderShipment({ provider: created.provider, providerOrderId: created.providerOrderId, awb: created.awb });
          return true;
        } catch {
          return false;
        }
      },
      pickup: async (created) => {
        const date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const pickup = await requestProviderPickup({ provider: created.provider, providerShipmentId: created.providerShipmentId, date });
        created.pickupReference = pickup.reference;
        created.pickupStatus = pickup.time ? pickup.time : (pickup.status || "requested");
        created.pickupDate = pickup.date || date;
      },
    });

    if (!outcome.ok && outcome.creates === 0) {
      return NextResponse.json({ ok: false, error: outcome.reason.slice(0, 180), code: outcome.code }, { status: outcome.code === "ACTIVE" ? 409 : 502, headers: { "Cache-Control": "no-store" } });
    }

    const rejected = !outcome.ok;
    const rowStatus = rejected ? (outcome.code === "CANCELLED" ? "cancelled" : "created") : "created";
    const saved = outcome.created;
    if (saved) {
      await db.from("store_shipments").insert({
        order_id: order.id,
        provider: saved.provider,
        provider_shipment_id: saved.providerShipmentId,
        courier_name: saved.courierName || body?.courier || null,
        awb: saved.awb,
        status: rowStatus,
        weight_grams: pack.weightGrams,
        length_mm: Math.round(pack.lengthCm * 10),
        width_mm: Math.round(pack.widthCm * 10),
        height_mm: Math.round(pack.heightCm * 10),
        pickup_scheduled_at: outcome.ok && outcome.code === "PICKUP_SCHEDULED" && saved.pickupDate ? `${saved.pickupDate.slice(0, 10)}T00:00:00.000Z` : null,
        provider_payload: {
          attempt,
          label_url: saved.labelUrl,
          provider_order_id: saved.providerOrderId,
          courier_id: body?.courier_id || null,
          rate_paise: Number.isFinite(Number(body?.rate_paise)) ? Number(body?.rate_paise) : null,
          requested_pin: address.pincode,
          requested_city: address.city,
          requested_state: address.state,
          provider_pin: saved.storedPin || null,
          provider_city: saved.storedCity || null,
          provider_state: saved.storedState || null,
          phone_stored: saved.phoneStored === true,
          address_mismatch: saved.addressMismatch === true,
          address_unverified: saved.addressUnverified === true,
          do_not_handoff: rejected,
          pickup_reference: saved.pickupReference || null,
          pickup_status: saved.pickupStatus || null,
          pickup_date: saved.pickupDate || null,
          cancellation_reason: rejected ? "VERIFICATION_FAILED" : null,
        },
      });
    }

    if (!outcome.ok) {
      await db.from("store_order_events").insert({
        order_id: order.id,
        event: outcome.code === "CANCELLED" ? "CANDIDATE_CANCELLED" : "SHIPMENT_CREATED",
        from_status: order.status,
        to_status: order.status,
        actor_type: "admin",
        actor_id: actor?.id,
        actor_name: actor?.name,
        payload_json: { provider, reason: outcome.reason.slice(0, 180), automatic_next: false },
      });
      return NextResponse.json(
        { ok: false, error: outcome.reason.slice(0, 180), code: outcome.code, order_status: order.status },
        { status: outcome.code === "CANCEL_UNCONFIRMED" ? 409 : 422, headers: { "Cache-Control": "no-store" } },
      );
    }

    const nextStatus = orderStatusAfterBooking(order.status, outcome.code === "PICKUP_SCHEDULED") || order.status;
    if (nextStatus !== order.status) {
      await db.from("store_orders").update({
        status: nextStatus,
        fulfillment_state: outcome.pickupError ? "pickup_pending" : "ready",
        fulfillment_note: outcome.pickupError,
        updated_at: new Date().toISOString(),
      }).eq("id", order.id).eq("status", order.status);
    }
    await db.from("store_order_events").insert({
      order_id: order.id,
      event: outcome.code === "PICKUP_SCHEDULED" ? "PICKUP_REQUESTED" : "SHIPMENT_CREATED",
      from_status: order.status,
      to_status: nextStatus,
      actor_type: "admin",
      actor_id: actor?.id,
      actor_name: actor?.name,
      payload_json: { provider, awb_assigned: true, automatic_next: false },
    });
    return NextResponse.json(
      {
        ok: true,
        provider,
        awb: outcome.created.awb,
        label_url: outcome.created.labelUrl,
        order_status: nextStatus,
        pickup: outcome.code === "PICKUP_SCHEDULED",
        pickup_error: outcome.pickupError,
        writes_authorized: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    await release();
  }
}
