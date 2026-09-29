import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { createProviderShipment, requestProviderPickup, cancelProviderShipment } from "@/lib/store/shipping/book";
import { dispatchBlocked, shipmentAlreadyActive } from "@/lib/store/shipping/dispatch";
import { assertPackage } from "@/lib/store/shipping/quotes";
import { canAdvanceOrder } from "@/lib/store/shipping/status";
import { bookSelectedCourier, resolveBookingPackage, type SelectedCreated } from "@/lib/store/shipping/manualBook";
import type { PackageLine } from "@/lib/store/shipping/autoFulfill";

export const dynamic = "force-dynamic";

const BOOKABLE = new Set(["PACKED", "READY_FOR_PICKUP"]);
const LOCK_MS = 15 * 60 * 1000;

/**
 * Book the one courier a person selected.
 * Does not choose a replacement courier and does not mark the parcel picked up.
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
    courier?: string;
    service?: string;
    rate_paise?: number;
  } | null;
  const provider = body?.provider === "shiprocket" || body?.provider === "delhivery" ? body.provider : null;
  const courier = String(body?.courier || "").trim();
  const service = String(body?.service || "").trim();
  const ratePaise = Number(body?.rate_paise);
  if (!provider || !courier || !Number.isFinite(ratePaise) || ratePaise <= 0) {
    return NextResponse.json({ ok: false, error: "Select a courier before booking." }, { status: 400 });
  }

  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const now = new Date().toISOString();
  const stale = new Date(Date.now() - LOCK_MS).toISOString();
  const { data: order } = await db
    .from("store_orders")
    .update({ fulfillment_lock_at: now, fulfillment_state: "booking", updated_at: now })
    .eq("id", params.id)
    .or(`fulfillment_lock_at.is.null,fulfillment_lock_at.lt.${stale}`)
    .select("id,status,order_no,total_paise,shipping_address_id")
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ ok: false, error: "Booking is already in progress. Refresh the order." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  const release = async (state: string, note: string | null) => {
    await db.from("store_orders").update({
      fulfillment_lock_at: null,
      fulfillment_state: state,
      fulfillment_note: note,
      updated_at: new Date().toISOString(),
    }).eq("id", order.id);
  };

  const fail = async (status: number, error: string, state = "blocked") => {
    await release(state, error.slice(0, 160));
    return NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
  };

  if (!BOOKABLE.has(order.status)) {
    return fail(409, "Pack the order before creating a shipment.", "waiting");
  }

  const { data: shipmentRows } = await db
    .from("store_shipments")
    .select("id,status,awb,weight_grams,length_mm,width_mm,height_mm,provider_payload")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false });
  const active = (shipmentRows || []).find((row) => shipmentAlreadyActive(row.status, row.awb));
  const saved = (shipmentRows || []).find((row) => row.weight_grams && row.length_mm && row.width_mm && row.height_mm) || null;
  const { data: itemRows } = await db.from("store_order_items").select("qty,weight_grams_snapshot,product_id,name_snapshot").eq("order_id", order.id);
  const lines: PackageLine[] = [];
  for (const item of itemRows || []) {
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
  const pack = resolveBookingPackage({
    override: saved
      ? { weightGrams: saved.weight_grams, lengthMm: saved.length_mm, widthMm: saved.width_mm, heightMm: saved.height_mm }
      : null,
    lines,
  });
  if (!pack.ok) return fail(400, "Save the packed weight and dimensions first.");
  const invalid = assertPackage({ weightGrams: pack.weightGrams, lengthCm: pack.lengthCm, widthCm: pack.widthCm, heightCm: pack.heightCm });
  if (invalid) return fail(400, invalid);

  const { data: address } = await db
    .from("store_addresses")
    .select("name,phone,line1,line2,city,state,pincode")
    .eq("id", order.shipping_address_id)
    .maybeSingle();
  if (!address?.pincode || !address.line1 || !address.city || !address.state) {
    return fail(400, "The ship-to address is incomplete.");
  }
  const product = (itemRows || []).map((it) => it.name_snapshot).filter(Boolean).join(", ").slice(0, 120) || "Printed notes";
  const attempt = (shipmentRows || []).length + 1;

  const result = await bookSelectedCourier({
    selected: {
      provider,
      courier,
      service: service || "Surface",
      courierId: body?.courier_id || null,
      ratePaise,
    },
    activeAwb: active?.awb || null,
    create: async () => {
      const created = await createProviderShipment({
        provider,
        courierId: body?.courier_id || null,
        orderNumber: `${order.order_no}-M${attempt}`,
        name: address.name || "Customer",
        address: [address.line1, address.line2].filter(Boolean).join(", "),
        pin: address.pincode,
        city: address.city,
        state: address.state,
        phone: address.phone || "",
        product,
        amountRupees: Math.round(Number(order.total_paise) || 0) / 100,
        weightGrams: pack.weightGrams,
        lengthCm: pack.lengthCm,
        widthCm: pack.widthCm,
        heightCm: pack.heightCm,
        shippingMode: /express/i.test(service) ? "Express" : "Surface",
      });
      return {
        awb: created.awb,
        labelUrl: created.labelUrl,
        providerOrderId: created.providerOrderId,
        providerShipmentId: created.providerShipmentId,
        courierName: created.courierName || courier,
        addressMismatch: created.addressMismatch === true,
        unverified: created.addressUnverified === true,
        possessed: false,
      } satisfies SelectedCreated;
    },
    cancel: async (created) => {
      try {
        if (created.awb || created.providerOrderId) {
          await cancelProviderShipment({ provider, providerOrderId: created.providerOrderId, awb: created.awb });
        }
        return true;
      } catch {
        return false;
      }
    },
    requestPickup: async (created) => {
      const date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await requestProviderPickup({
        provider,
        providerShipmentId: created.providerShipmentId,
        date,
      });
    },
  });

  if (!result.ok) {
    if (result.creates > 0) {
      const keep = result.blocked === "EXISTING_AWB" && result.awb;
      await db.from("store_shipments").insert({
        order_id: order.id,
        provider,
        provider_shipment_id: result.providerShipmentId,
        courier_name: result.courierName || courier,
        awb: result.awb,
        status: keep ? "created" : "cancelled",
        weight_grams: pack.weightGrams,
        length_mm: Math.round(pack.lengthCm * 10),
        width_mm: Math.round(pack.widthCm * 10),
        height_mm: Math.round(pack.heightCm * 10),
        provider_payload: {
          package_source: pack.source,
          rate_paise: ratePaise,
          do_not_use: !keep,
          do_not_handoff: true,
          cancellation_reason: keep ? null : "CANCELLED / DO NOT USE",
          selected_courier: courier,
        },
      });
    }
    await db.from("store_order_events").insert({
      order_id: order.id,
      event: "courier_selected",
      actor_type: "admin",
      actor_id: actor?.id,
      actor_name: actor?.name,
      payload_json: { provider, courier, service, rate_paise: ratePaise, result: "failed" },
    });
    return fail(result.blocked === "EXISTING_AWB" ? 409 : 502, result.message);
  }

  let pickupDate: string | null = null;
  let pickupStatus: string | null = null;
  if (result.pickupRequested) {
    pickupDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    pickupStatus = "requested";
  }
  const bookedAt = new Date().toISOString();
  await db.from("store_shipments").insert({
    order_id: order.id,
    provider,
    provider_shipment_id: result.providerShipmentId,
    courier_name: result.courierName || courier,
    awb: result.awb,
    status: "created",
    weight_grams: pack.weightGrams,
    length_mm: Math.round(pack.lengthCm * 10),
    width_mm: Math.round(pack.widthCm * 10),
    height_mm: Math.round(pack.heightCm * 10),
    pickup_scheduled_at: result.pickupRequested && pickupDate ? `${pickupDate}T00:00:00.000Z` : null,
    provider_payload: {
      package_source: pack.source,
      rate_paise: ratePaise,
      label_url: result.labelUrl,
      provider_order_id: result.providerOrderId,
      courier_id: body?.courier_id || null,
      service: service || null,
      selected_courier: courier,
      selected_at: bookedAt,
      selected_by: actor?.name || actor?.id || "admin",
      requested_pin: address.pincode,
      requested_city: address.city,
      requested_state: address.state,
      phone_stored: true,
      address_mismatch: false,
      do_not_handoff: false,
      pickup_date: pickupDate,
      pickup_status: pickupStatus,
    },
  });

  let orderStatus = order.status;
  if (result.pickupRequested && canAdvanceOrder(order.status, "PICKUP_SCHEDULED")) {
    orderStatus = "PICKUP_SCHEDULED";
  }
  await db.from("store_orders").update({
    status: orderStatus,
    fulfillment_lock_at: null,
    fulfillment_state: result.pickupRequested ? "ready" : "pickup_pending",
    fulfillment_note: result.pickupRequested ? null : result.message,
    updated_at: bookedAt,
  }).eq("id", order.id);
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "courier_selected",
    from_status: order.status,
    to_status: orderStatus,
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: {
      provider,
      courier,
      service,
      rate_paise: ratePaise,
      result: result.pickupRequested ? "booked" : "pickup_pending",
      awb_assigned: true,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      provider,
      courier: result.courierName || courier,
      awb: result.awb,
      rate_paise: ratePaise,
      label_url: result.labelUrl,
      pickup_requested: result.pickupRequested,
      pickup_status: pickupStatus,
      order_status: orderStatus,
      writes_authorized: true,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
