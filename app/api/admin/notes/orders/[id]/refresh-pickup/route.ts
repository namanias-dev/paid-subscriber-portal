import { NextResponse } from "next/server";
import { requireFreshPermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { deliveryOnlyGuard } from "@/lib/store/fulfillmentGuard";
import { trackDelhiveryAwb } from "@/lib/store/shipping/delhiveryApi";
import { trackShiprocketAwb } from "@/lib/store/shipping/shiprocketApi";
import { applyPickupRefresh, type PickupRefreshIO, type RefreshShipment } from "@/lib/store/shipping/refreshPickup";
import type { CourierProvider } from "@/lib/store/shipping/pickup";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * "Refresh courier status" — re-reads the carrier (best-effort) and then reconciles the
 * local order/pickup state from stored truth via {@link applyPickupRefresh}. This is the
 * staff-driven repair for the "booked but stuck in Packed" / "pickup cancelled at the
 * provider" drift: it advances the order, stamps the pickup lifecycle, and records an
 * audit event — all through the same path a webhook/cron would use. Never books or
 * cancels at the provider; a Case B (shipment cancelled) only supersedes the local row.
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
  const shipment = (shipmentRows || []).find((row) => row.status !== "cancelled" && row.status !== "failed") || null;
  if (!shipment) {
    return NextResponse.json({ ok: false, error: "No active courier shipment for this order." }, { status: 404, headers: NO_STORE });
  }

  // Best-effort carrier re-read: refresh the stored tracking wording so the reconcile below
  // works off the latest provider signal. A provider/network failure must not block the repair.
  let payload = (shipment.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as Record<string, unknown>;
  let carrierError: string | null = null;
  if (shipment.awb) {
    try {
      const tracked =
        shipment.provider === "delhivery"
          ? await trackDelhiveryAwb(shipment.awb)
          : shipment.provider === "shiprocket"
            ? await trackShiprocketAwb(shipment.awb)
            : null;
      const rawStatus = tracked && "rawStatus" in tracked ? (tracked.rawStatus as string | null) : null;
      carrierError = tracked && "error" in tracked ? ((tracked.error as string | null) ?? null) : null;
      if (rawStatus) {
        payload = {
          ...payload,
          tracking_status: rawStatus,
          tracking_courier: tracked && "courier" in tracked ? tracked.courier : null,
          tracking_activity: tracked && "activity" in tracked ? tracked.activity : null,
          tracking_event_at: tracked && "eventTime" in tracked ? tracked.eventTime : null,
          tracking_location: tracked && "location" in tracked ? tracked.location : null,
        };
        await db
          .from("store_shipments")
          .update({ provider_payload: payload, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", shipment.id);
      }
    } catch {
      carrierError = "carrier_unreachable";
    }
  }

  const row: RefreshShipment = {
    id: shipment.id,
    provider: (shipment.provider as CourierProvider) ?? "manual",
    awb: shipment.awb ?? null,
    shipmentStatus: shipment.status ?? null,
    trackingStatus: (payload.tracking_status as string | null) ?? null,
    pickupStatusRaw: (payload.pickup_status as string | null) ?? null,
    pickupState: (shipment.pickup_state as RefreshShipment["pickupState"]) ?? "NOT_REQUESTED",
    active: true,
  };

  const io: PickupRefreshIO = {
    async advanceOrder(from, to) {
      const { data } = await db.from("store_orders").update({ status: to, updated_at: new Date().toISOString() }).eq("id", order.id).eq("status", from).select("id");
      return Array.isArray(data) && data.length > 0;
    },
    async patchShipment(shipmentId, patch) {
      await db.from("store_shipments").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", shipmentId);
    },
    async recordEvent(orderId, input, who) {
      await db.from("store_order_events").insert({
        order_id: orderId,
        event: "courier_pickup_synced",
        from_status: input.fromStatus,
        to_status: input.toStatus,
        actor_type: "admin",
        actor_id: who.id ?? null,
        actor_name: who.name ?? null,
        payload_json: { basis: input.basis, pickup_state: input.pickupState, cancel_shipment: input.cancelShipment, reason: input.reason, source: "manual_refresh" },
      });
    },
  };

  const outcome = await applyPickupRefresh({ id: order.id, status: order.status }, row, { id: actor?.id, name: actor?.name }, io);

  return NextResponse.json(
    {
      ok: true,
      changed: outcome.changed,
      order_status: outcome.orderStatus,
      pickup_state: outcome.pickupState,
      basis: outcome.basis,
      note: outcome.note ?? null,
      carrier_error: carrierError,
    },
    { headers: NO_STORE },
  );
}
