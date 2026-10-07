import { NextResponse } from "next/server";
import { requireFreshPermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { requestProviderPickup } from "@/lib/store/shipping/book";
import { dispatchBlocked } from "@/lib/store/shipping/dispatch";
import { canAdvanceOrder } from "@/lib/store/shipping/status";
import { validatePickupDate } from "@/lib/store/shipping/pickup";
import { SHIPMENT_ADDRESS_MISMATCH, shipmentHandoffBlocked } from "@/lib/store/address";
import { deliveryOnlyGuard } from "@/lib/store/fulfillmentGuard";

export const dynamic = "force-dynamic";

/**
 * Ask the courier to collect a parcel that already has a shipment.
 * Does not mark the order shipped. Possession still comes from a carrier scan.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requireFreshPermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const blocked = dispatchBlocked();
  if (blocked) {
    return NextResponse.json({ ok: false, error: blocked, writes_authorized: false }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const body = (await req.json().catch(() => null)) as { date?: string; reattempt?: boolean } | null;
  const date = String(body?.date || "").trim();
  const reattempt = body?.reattempt === true;
  // Server-side revalidation of the requested date in IST, so a forged/stale date is refused
  // before any provider call (§8). An empty date defers to the provider default (Delhivery).
  if (date) {
    const check = validatePickupDate(date, { nowIso: new Date().toISOString(), maxAheadDays: 10 });
    if (!check.ok) {
      const message =
        check.reason === "past" ? "Pickup date cannot be in the past."
        : check.reason === "too_far" ? "Pickup date is too far ahead."
        : check.reason === "cutoff" ? "Same-day pickup is past today's cut-off."
        : "That pickup date is not valid.";
      return NextResponse.json({ ok: false, error: message, reason: check.reason }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  }
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const pickupRefusal = await deliveryOnlyGuard(db, params.id, "pickup");
  if (pickupRefusal) return pickupRefusal;

  const { data: order } = await db.from("store_orders").select("id,status").eq("id", params.id).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const { data: shipmentRows } = await db
    .from("store_shipments")
    .select("id,provider,provider_shipment_id,awb,status,provider_payload")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false });
  const shipment = (shipmentRows || []).find((row) => row.status !== "cancelled" && row.status !== "failed") || null;
  if (!shipment?.awb || (shipment.provider !== "shiprocket" && shipment.provider !== "delhivery")) {
    return NextResponse.json({ ok: false, error: "Create the courier shipment before scheduling pickup." }, { status: 409 });
  }
  const existingPayload = (shipment.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as Record<string, unknown>;
  if (reattempt && (shipment.provider !== "shiprocket" || !shipment.provider_shipment_id)) {
    return NextResponse.json({ ok: false, error: "This reattempt only applies to the existing Shiprocket shipment." }, { status: 409 });
  }
  if (reattempt && existingPayload.pickup_reattempt_date === date && existingPayload.pickup_status === "reattempt_requested") {
    return NextResponse.json(
      { ok: true, already: true, pickup_date: date, pickup_reference: existingPayload.pickup_reference || null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (shipmentHandoffBlocked(existingPayload)) {
    return NextResponse.json(
      { ok: false, error: SHIPMENT_ADDRESS_MISMATCH, code: SHIPMENT_ADDRESS_MISMATCH },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  let pickup;
  try {
    pickup = await requestProviderPickup({
      provider: shipment.provider,
      providerShipmentId: shipment.provider_shipment_id,
      date,
      retry: reattempt,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Pickup was not scheduled.";
    // §11 timeout safety: a timed-out / aborted request may have landed at the provider. We must
    // NOT immediately re-issue the write (that risks a duplicate pickup). Mark the state as
    // "being verified" and send staff to Refresh courier status, which does a provider READ.
    if (/timed? ?out|etimedout|aborted|network|socket|fetch failed|econnreset/i.test(message)) {
      const stamp = new Date().toISOString();
      await db
        .from("store_shipments")
        .update({ provider_pickup_status: "verifying", provider_pickup_status_at: stamp, pickup_last_synced_at: stamp, updated_at: stamp })
        .eq("id", shipment.id);
      return NextResponse.json(
        { ok: false, verifying: true, error: "Pickup scheduling is being verified. Refresh courier status in a moment before trying again." },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json({ ok: false, error: message.slice(0, 180) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const now = new Date().toISOString();
  const payload = (shipment.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as Record<string, unknown>;
  const dateOnly = pickup.date.slice(0, 10);
  const scheduledAt = /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? `${dateOnly}T00:00:00.000Z` : now;
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const confirmedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null;
  await db
    .from("store_shipments")
    .update({
      pickup_scheduled_at: scheduledAt,
      // Courier pickup lifecycle (§10, §16): requested vs provider-confirmed date are stored
      // separately, so the UI shows the confirmed date when the provider moves it.
      pickup_state: "SCHEDULED",
      pickup_status_source: "STAFF_ACTION",
      pickup_requested_date: requestedDate,
      pickup_confirmed_date: confirmedDate,
      pickup_slot: pickup.time || null,
      pickup_request_id: pickup.reference || payload.pickup_reference || null,
      provider_pickup_status: reattempt ? "reattempt_requested" : pickup.status || "requested",
      provider_pickup_status_at: now,
      pickup_last_synced_at: now,
      provider_payload: {
        ...payload,
        pickup_reference: pickup.reference || payload.pickup_reference,
        pickup_previous_reference: reattempt ? payload.pickup_reference || null : payload.pickup_previous_reference,
        pickup_date: dateOnly,
        pickup_requested_date: requestedDate,
        pickup_status: reattempt ? "reattempt_requested" : pickup.status || "requested",
        ...(reattempt ? { pickup_reattempt_date: dateOnly } : {}),
        ...(pickup.time ? { pickup_time: pickup.time } : {}),
      },
      updated_at: now,
    })
    .eq("id", shipment.id);

  let orderStatus = order.status;
  if (canAdvanceOrder(order.status, "PICKUP_SCHEDULED")) {
    orderStatus = "PICKUP_SCHEDULED";
    await db.from("store_orders").update({ status: orderStatus, updated_at: now }).eq("id", order.id);
  }
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "pickup_scheduled",
    from_status: order.status,
    to_status: orderStatus,
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: { provider: shipment.provider, requested_date: requestedDate, confirmed_date: confirmedDate, pickup_reference: pickup.reference, reattempt },
  });

  return NextResponse.json(
    { ok: true, order_status: orderStatus, pickup_date: pickup.date, pickup_reference: pickup.reference },
    { headers: { "Cache-Control": "no-store" } },
  );
}
