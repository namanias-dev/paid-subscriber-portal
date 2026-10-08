import { NextResponse } from "next/server";
import { requireFreshPermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { deliveryOnlyGuard } from "@/lib/store/fulfillmentGuard";
import { selectActiveShipment } from "@/lib/store/shipping/activeShipment";
import { cancelProviderShipment } from "@/lib/store/shipping/book";
import { trackDelhiveryAwb } from "@/lib/store/shipping/delhiveryApi";
import { trackShiprocketAwb } from "@/lib/store/shipping/shiprocketApi";
import { POSSESSION_ORDER_STATUSES, normalizeCourierPickupStatus } from "@/lib/store/shipping/pickup";
import { makeSupabasePickupIO, reconcilePickupFromProvider, toCourierProvider } from "@/lib/store/shipping/refreshPickup";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Staff explicitly leaves a still-valid AWB (Case A) so they can compare couriers again.
 * Does not choose or book a replacement. A failed provider read changes nothing.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requireFreshPermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== "CHANGE_COURIER") {
    return NextResponse.json({ ok: false, error: "Confirm the courier change before the current shipment is cancelled." }, { status: 400, headers: NO_STORE });
  }

  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: NO_STORE });
  const pickupRefusal = await deliveryOnlyGuard(db, params.id, "change-courier");
  if (pickupRefusal) return pickupRefusal;

  const { data: order } = await db.from("store_orders").select("id,status,fulfillment_method").eq("id", params.id).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404, headers: NO_STORE });
  if (POSSESSION_ORDER_STATUSES.has(order.status)) {
    return NextResponse.json({ ok: false, error: "The courier already has this parcel." }, { status: 409, headers: NO_STORE });
  }

  const { data: shipmentRows } = await db
    .from("store_shipments")
    .select("id,provider,awb,status,pickup_state,provider_shipment_id,provider_payload,created_at")
    .eq("order_id", params.id)
    .order("created_at", { ascending: false });
  const shipment = selectActiveShipment(shipmentRows || []);
  if (!shipment?.awb || (shipment.provider !== "delhivery" && shipment.provider !== "shiprocket")) {
    return NextResponse.json({ ok: false, error: "No live courier shipment to change." }, { status: 409, headers: NO_STORE });
  }

  let rawStatus: string | null = null;
  let rawRemark: string | null = null;
  try {
    const tracked = shipment.provider === "delhivery" ? await trackDelhiveryAwb(shipment.awb) : await trackShiprocketAwb(shipment.awb);
    const err = tracked && "error" in tracked ? (tracked.error as string | null) : null;
    rawStatus = tracked && "rawStatus" in tracked ? (tracked.rawStatus as string | null) : null;
    rawRemark = tracked && "activity" in tracked ? ((tracked.activity as string | null) ?? null) : null;
    if (err || !rawStatus) {
      return NextResponse.json(
        { ok: false, verified: false, error: "Courier status could not be verified. Nothing was changed." },
        { status: 502, headers: NO_STORE },
      );
    }
  } catch {
    return NextResponse.json(
      { ok: false, verified: false, error: "Courier status could not be verified. Nothing was changed." },
      { status: 502, headers: NO_STORE },
    );
  }

  const fact = normalizeCourierPickupStatus({ provider: shipment.provider, rawStatus, rawRemark });
  if (fact.pickupState === "PICKED_UP") {
    return NextResponse.json({ ok: false, error: "The courier already has this parcel." }, { status: 409, headers: NO_STORE });
  }

  // Already cancelled at the provider: repair locally. Do not send another cancel.
  if (!fact.shipmentCancelled) {
    const payload = (shipment.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as {
      provider_order_id?: string;
    };
    const providerOrderId = typeof payload.provider_order_id === "string" ? payload.provider_order_id : null;
    if (shipment.provider === "shiprocket" && !providerOrderId) {
      return NextResponse.json(
        { ok: false, error: "This shipment cannot be cancelled safely. Nothing was changed." },
        { status: 409, headers: NO_STORE },
      );
    }
    try {
      await cancelProviderShipment({
        provider: shipment.provider,
        providerOrderId,
        awb: shipment.awb,
      });
    } catch {
      return NextResponse.json(
        { ok: false, error: "The courier did not accept the cancellation. The current shipment is unchanged." },
        { status: 502, headers: NO_STORE },
      );
    }
  }

  const io = makeSupabasePickupIO(db, order.id);
  const outcome = await reconcilePickupFromProvider(
    { id: order.id, status: order.status },
    {
      id: shipment.id,
      provider: toCourierProvider(shipment.provider),
      awb: shipment.awb,
      shipmentStatus: shipment.status,
      pickupState: (shipment.pickup_state as never) ?? "NOT_REQUESTED",
      active: true,
    },
    "Shipment Cancelled",
    fact.shipmentCancelled ? rawStatus : "Staff changed courier",
    { id: actor?.id, name: actor?.name },
    io,
    "STAFF_ACTION",
  );

  return NextResponse.json(
    {
      ok: true,
      order_status: outcome.orderStatus,
      provider_writes: fact.shipmentCancelled ? 0 : 1,
    },
    { headers: NO_STORE },
  );
}
