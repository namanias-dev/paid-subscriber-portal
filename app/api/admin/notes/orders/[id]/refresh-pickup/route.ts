import { NextResponse } from "next/server";
import { requireFreshPermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { deliveryOnlyGuard } from "@/lib/store/fulfillmentGuard";
import { selectActiveShipment } from "@/lib/store/shipping/activeShipment";
import { trackDelhiveryAwb } from "@/lib/store/shipping/delhiveryApi";
import { trackShiprocketAwb } from "@/lib/store/shipping/shiprocketApi";
import {
  reconcilePickupFromProvider,
  makeSupabasePickupIO,
  planRetiredShipmentOrder,
  toCourierProvider,
  type RefreshShipment,
} from "@/lib/store/shipping/refreshPickup";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * "Refresh courier status" — the staff-driven read + reconcile.
 *
 * Safety (§1): the canonical order/shipment state is only mutated from a SUCCESSFUL live
 * provider read (A). If the provider read fails (B) we change nothing and tell the staff to
 * retry — we never reconcile off stale local data just because someone pressed the button.
 * Learning from already-persisted authenticated provider evidence (C) is the job of the
 * webhook and the cron, not of a failed manual refresh.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requireFreshPermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const pickupRefusal = await deliveryOnlyGuard(db, params.id, "refresh-pickup");
  if (pickupRefusal) return pickupRefusal;

  const { data: order } = await db.from("store_orders").select("id,status").eq("id", params.id).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404, headers: NO_STORE });

  const { data: shipmentRows } = await db
    .from("store_shipments")
    .select("id,provider,awb,status,pickup_state,provider_payload")
    .eq("order_id", params.id)
    .order("created_at", { ascending: false });
  const shipment = selectActiveShipment(shipmentRows || []);
  if (!shipment) {
    const next = planRetiredShipmentOrder({ orderStatus: order.status, rows: shipmentRows || [] });
    if (!next) {
      return NextResponse.json({ ok: false, error: "No active courier shipment for this order." }, { status: 404, headers: NO_STORE });
    }
    const { data: moved } = await db
      .from("store_orders")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("status", order.status)
      .select("id");
    if (!Array.isArray(moved) || moved.length === 0) {
      return NextResponse.json({ ok: true, verified: true, changed: false, order_status: order.status, pickup_state: null, basis: "shipment_cancelled", note: "stale" }, { headers: NO_STORE });
    }
    await db.from("store_order_events").insert({
      order_id: order.id,
      event: "courier_pickup_synced",
      from_status: order.status,
      to_status: next,
      actor_type: "admin",
      actor_id: actor?.id ?? null,
      actor_name: actor?.name ?? null,
      payload_json: { basis: "shipment_cancelled", source: "MANUAL_REFRESH", cancel_shipment: false, reason: "retired_shipment_no_active_awb" },
    });
    return NextResponse.json(
      { ok: true, verified: true, changed: true, order_status: next, pickup_state: "CANCELLED", basis: "shipment_cancelled", note: null },
      { headers: NO_STORE },
    );
  }
  if (!shipment.awb || shipment.provider === "manual") {
    return NextResponse.json({ ok: false, error: "No courier AWB to verify for this order." }, { status: 409, headers: NO_STORE });
  }

  // (A/B) Live provider read. A failure here must NOT change any canonical state.
  let rawStatus: string | null = null;
  let rawRemark: string | null = null;
  try {
    const tracked =
      shipment.provider === "delhivery"
        ? await trackDelhiveryAwb(shipment.awb)
        : await trackShiprocketAwb(shipment.awb);
    const err = tracked && "error" in tracked ? (tracked.error as string | null) : null;
    rawStatus = tracked && "rawStatus" in tracked ? (tracked.rawStatus as string | null) : null;
    rawRemark = tracked && "activity" in tracked ? ((tracked.activity as string | null) ?? null) : null;
    if (err || !rawStatus) {
      return NextResponse.json(
        { ok: false, verified: false, error: "Courier status could not be verified. Please try again." },
        { status: 502, headers: NO_STORE },
      );
    }
    // Persist the fresh provider wording so the reconcile (and the UI) see current truth.
    const payload = (shipment.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as Record<string, unknown>;
    await db
      .from("store_shipments")
      .update({
        provider_payload: {
          ...payload,
          tracking_status: rawStatus,
          tracking_courier: tracked && "courier" in tracked ? tracked.courier : null,
          tracking_activity: rawRemark,
          tracking_event_at: tracked && "eventTime" in tracked ? tracked.eventTime : null,
          tracking_location: tracked && "location" in tracked ? tracked.location : null,
        },
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", shipment.id);
  } catch {
    return NextResponse.json(
      { ok: false, verified: false, error: "Courier status could not be verified. Please try again." },
      { status: 502, headers: NO_STORE },
    );
  }

  const row: RefreshShipment = {
    id: shipment.id,
    provider: toCourierProvider(shipment.provider),
    awb: shipment.awb ?? null,
    shipmentStatus: shipment.status ?? null,
    trackingStatus: rawStatus,
    pickupStatusRaw: rawStatus,
    pickupState: (shipment.pickup_state as RefreshShipment["pickupState"]) ?? "NOT_REQUESTED",
    active: true,
  };

  const io = makeSupabasePickupIO(db, order.id);
  const outcome = await reconcilePickupFromProvider(
    { id: order.id, status: order.status },
    row,
    rawStatus,
    rawRemark,
    { id: actor?.id, name: actor?.name },
    io,
    "MANUAL_REFRESH",
  );

  return NextResponse.json(
    { ok: true, verified: true, changed: outcome.changed, order_status: outcome.orderStatus, pickup_state: outcome.pickupState, basis: outcome.basis, note: outcome.note ?? null },
    { headers: NO_STORE },
  );
}
