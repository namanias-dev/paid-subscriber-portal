import { NextResponse } from "next/server";
import { requireFreshPermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { createProviderShipment, requestProviderPickup, cancelProviderShipment } from "@/lib/store/shipping/book";
import { dispatchBlocked, shipmentAlreadyActive } from "@/lib/store/shipping/dispatch";
import { assertPackage } from "@/lib/store/shipping/quotes";
import { canAdvanceOrder } from "@/lib/store/shipping/status";
import { bookSelectedCourier, resolveBookingPackage, type SelectedCreated } from "@/lib/store/shipping/manualBook";
import type { PackageLine } from "@/lib/store/shipping/autoFulfill";
import {
  cityConfirmationView,
  classifyCourierDestination,
  normalizedCustomerPhone,
  pinDestinationContext,
  shipmentQuoteAudit,
} from "@/lib/store/shipping/destinationCheck";

export const dynamic = "force-dynamic";

const BOOKABLE = new Set(["PACKED", "READY_FOR_PICKUP"]);
const LOCK_MS = 15 * 60 * 1000;

function payloadOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function quoteAudit(input: { ratePaise: number; provider: string; courier: string; service: string; actorName: string | null | undefined }) {
  return shipmentQuoteAudit({
    ratePaise: input.ratePaise,
    provider: input.provider,
    courier: input.courier,
    service: input.service,
    selectedAt: new Date().toISOString(),
    selectedBy: input.actorName || "admin",
  });
}

/**
 * Confirm or decline only the provider city on a shipment that is already waiting.
 * The customer address is not rewritten. A live AWB that is not in this state is left alone.
 */
async function decideCourierCity(orderId: string, action: "confirm_city" | "decline_city") {
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - LOCK_MS).toISOString();
  const { data: order } = await db
    .from("store_orders")
    .update({ fulfillment_lock_at: now, fulfillment_state: "booking", updated_at: now })
    .eq("id", orderId)
    .or(`fulfillment_lock_at.is.null,fulfillment_lock_at.lt.${stale}`)
    .select("id,status,shipping_address_id")
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ ok: false, error: "Booking is already in progress. Refresh the order." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const release = async (state: string, note: string | null, status?: string) => {
    await db.from("store_orders").update({
      fulfillment_lock_at: null,
      fulfillment_state: state,
      fulfillment_note: note,
      ...(status ? { status } : {}),
      updated_at: new Date().toISOString(),
    }).eq("id", order.id);
  };
  const { data: rows } = await db
    .from("store_shipments")
    .select("id,status,awb,provider,provider_shipment_id,courier_name,provider_payload")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false });
  const row = (rows || []).find((item) => {
    const payload = payloadOf(item.provider_payload);
    return Boolean(item.awb) && item.status === "created" && payload.city_confirm_required === true && payload.destination_accepted !== true;
  });
  if (!row) {
    await release(order.status === "PACKED" || order.status === "READY_FOR_PICKUP" ? "waiting" : "ready", null);
    return NextResponse.json({ ok: false, error: "This shipment is not waiting for city confirmation." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const payload = payloadOf(row.provider_payload);
  const provider = row.provider === "shiprocket" || row.provider === "delhivery" ? row.provider : null;
  if (!provider) {
    await release("blocked", "This shipment is not waiting for city confirmation.");
    return NextResponse.json({ ok: false, error: "This shipment is not waiting for city confirmation." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  if (action === "decline_city") {
    let cancelled = false;
    try {
      await cancelProviderShipment({
        provider,
        providerOrderId: String(payload.provider_order_id || row.provider_shipment_id || ""),
        awb: row.awb,
      });
      cancelled = true;
    } catch {
      cancelled = false;
    }
    if (!cancelled) {
      await db.from("store_shipments").update({
        provider_payload: { ...payload, do_not_handoff: true },
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      await release("blocked", "The shipment could not be cancelled, so no second shipment was created.");
      return NextResponse.json(
        { ok: false, error: "The shipment could not be cancelled, so no second shipment was created." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    await db.from("store_shipments").update({
      status: "cancelled",
      provider_payload: {
        ...payload,
        city_confirm_required: false,
        destination_accepted: false,
        do_not_handoff: true,
        do_not_use: true,
        cancellation_reason: "CANCELLED / DO NOT USE",
      },
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    await db.from("store_order_events").insert({
      order_id: order.id,
      event: "courier_selected",
      actor_type: "admin",
      actor_id: actor?.id,
      actor_name: actor?.name,
      payload_json: { result: "city_declined", awb_assigned: true },
    });
    await release("waiting", null);
    return NextResponse.json({ ok: true, city_confirm: false, declined: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data: address } = await db.from("store_addresses").select("city,state,pincode").eq("id", order.shipping_address_id).maybeSingle();
  if (!address?.pincode || !address.city || !address.state) {
    await release("blocked", "The ship-to address is incomplete.");
    return NextResponse.json({ ok: false, error: "The ship-to address is incomplete." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const { data: pinRow } = await db.from("store_pincode_cache").select("city,district,state").eq("pincode", address.pincode).maybeSingle();
  const pinContext = pinDestinationContext(
    pinRow ? { ...pinRow, pincode: address.pincode } : null,
    { pincode: address.pincode, state: address.state },
  );
  const decision = classifyCourierDestination({
    order: { city: address.city, state: address.state, pincode: address.pincode },
    provider: {
      city: String(payload.provider_city || ""),
      state: String(payload.provider_state || ""),
      pincode: String(payload.provider_pin || ""),
    },
    canonicalCity: pinContext.canonicalCity,
    aliases: pinContext.aliases,
  });
  if (decision.verdict === "fail") {
    await release("blocked", "Unavailable — destination mismatch.");
    return NextResponse.json({ ok: false, error: "Unavailable — destination mismatch.", reason: "destination_mismatch" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  const date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let pickupRequested = false;
  let pickupError: string | null = null;
  try {
    await requestProviderPickup({ provider, providerShipmentId: row.provider_shipment_id, date });
    pickupRequested = true;
  } catch (error) {
    pickupError = error instanceof Error ? error.message : "Pickup was not requested.";
  }
  await db.from("store_shipments").update({
    pickup_scheduled_at: pickupRequested ? `${date}T00:00:00.000Z` : null,
    provider_payload: {
      ...payload,
      destination_accepted: true,
      city_confirm_required: false,
      do_not_handoff: false,
      address_mismatch: false,
      pickup_date: pickupRequested ? date : null,
      pickup_status: pickupRequested ? "requested" : null,
    },
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  let orderStatus = order.status;
  if (pickupRequested && canAdvanceOrder(order.status, "PICKUP_SCHEDULED")) orderStatus = "PICKUP_SCHEDULED";
  await release(pickupRequested ? "ready" : "pickup_pending", pickupRequested ? null : pickupError, orderStatus);
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "courier_selected",
    from_status: order.status,
    to_status: orderStatus,
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: { result: pickupRequested ? "city_confirmed" : "pickup_pending", awb_assigned: true },
  });
  return NextResponse.json(
    {
      ok: true,
      city_confirm: false,
      courier: row.courier_name,
      awb: row.awb,
      rate_paise: Number(payload.booked_rate_paise) || Number(payload.rate_paise) || null,
      pickup_requested: pickupRequested,
      pickup_status: pickupRequested ? "requested" : null,
      order_status: orderStatus,
      writes_authorized: true,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Book the one courier a person selected.
 * Does not choose a replacement courier and does not mark the parcel picked up.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requireFreshPermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const blocked = dispatchBlocked();
  if (blocked) {
    return NextResponse.json({ ok: false, error: blocked, writes_authorized: false }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    provider?: string;
    courier_id?: string;
    courier?: string;
    service?: string;
    rate_paise?: number;
  } | null;
  if (body?.action === "confirm_city" || body?.action === "decline_city") {
    return decideCourierCity(params.id, body.action);
  }
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

  const fail = async (status: number, error: string, state = "blocked", reason?: string) => {
    await release(state, error.slice(0, 160));
    return NextResponse.json({ ok: false, error, ...(reason ? { reason } : {}) }, { status, headers: { "Cache-Control": "no-store" } });
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
  const sentPhone = normalizedCustomerPhone(address.phone);
  if (!sentPhone) return fail(400, "A valid 10-digit phone is required before booking.");
  const { data: pinRow } = await db.from("store_pincode_cache").select("city,district,state").eq("pincode", address.pincode).maybeSingle();
  const { canonicalCity, aliases: pinAliases } = pinDestinationContext(
    pinRow ? { ...pinRow, pincode: address.pincode } : null,
    { pincode: address.pincode, state: address.state },
  );
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
        phone: sentPhone,
        canonicalCity,
        cityAliases: pinAliases,
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
        cityConfirm: created.cityConfirm === true,
        unverified: created.addressUnverified === true,
        possessed: false,
        storedPin: created.storedPin,
        storedCity: created.storedCity,
        storedState: created.storedState,
        phoneStored: created.phoneStored,
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

  const audit = quoteAudit({ ratePaise, provider, courier, service: service || "Surface", actorName: actor?.name || actor?.id });
  const destinationPayload = {
    requested_pin: address.pincode,
    requested_city: address.city,
    requested_state: address.state,
    provider_pin: result.providerPin,
    provider_city: result.providerCity,
    provider_state: result.providerState,
  };

  if (result.blocked === "CITY_CONFIRM" && result.awb && result.providerCity && result.providerState) {
    const view = cityConfirmationView({
      orderCity: address.city,
      orderState: address.state,
      providerCity: result.providerCity,
      providerState: result.providerState,
      pincode: address.pincode,
    });
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
      provider_payload: {
        package_source: pack.source,
        ...audit,
        ...destinationPayload,
        label_url: result.labelUrl,
        provider_order_id: result.providerOrderId,
        courier_id: body?.courier_id || null,
        selected_courier: courier,
        phone_stored: result.phoneStored === true,
        address_mismatch: false,
        city_confirm_required: true,
        destination_accepted: false,
        do_not_handoff: true,
      },
    });
    await db.from("store_order_events").insert({
      order_id: order.id,
      event: "courier_selected",
      actor_type: "admin",
      actor_id: actor?.id,
      actor_name: actor?.name,
      payload_json: { provider, courier, service, rate_paise: ratePaise, result: "city_confirm", awb_assigned: true },
    });
    await release("city_confirm", "Confirm the courier city before pickup.");
    return NextResponse.json(
      {
        ok: true,
        city_confirm: true,
        provider,
        courier: result.courierName || courier,
        awb: result.awb,
        rate_paise: ratePaise,
        customer_destination: view.customer,
        courier_destination: view.courier,
        pin: view.pin,
        state: view.state,
        pickup_requested: false,
        writes_authorized: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

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
          ...audit,
          ...destinationPayload,
          do_not_use: !keep,
          do_not_handoff: true,
          address_mismatch: true,
          destination_accepted: false,
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
    const destinationMismatch = result.message.includes("destination mismatch");
    return fail(result.blocked === "EXISTING_AWB" ? 409 : 502, result.message, "blocked", destinationMismatch ? "destination_mismatch" : undefined);
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
      ...audit,
      ...destinationPayload,
      label_url: result.labelUrl,
      provider_order_id: result.providerOrderId,
      courier_id: body?.courier_id || null,
      selected_courier: courier,
      phone_stored: result.phoneStored === true,
      address_mismatch: false,
      city_confirm_required: false,
      destination_accepted: true,
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
