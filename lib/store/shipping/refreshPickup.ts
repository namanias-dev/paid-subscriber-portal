/**
 * Apply a courier pickup reconciliation to one order through the audited write path.
 *
 * This is the single runtime reconciler shared by every path that can learn a pickup
 * fact — the authenticated webhook, the pre-possession cron, the manual "Refresh courier
 * status" action, and staff schedule/reschedule — so they can never drift apart (§12).
 * The pure decision lives in {@link planLocalRepair} / {@link reconcileCourierShipment};
 * this module only persists a decision: an optimistically-locked order advance, the
 * shipment pickup columns, and a `courier_pickup_synced` audit event. It never calls a
 * provider.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  planLocalRepair,
  reconcileCourierShipment,
  normalizeCourierPickupStatus,
  type CourierProvider,
  type LocalShipmentRow,
  type PickupState,
  type ReconcileResult,
} from "./pickup";

/** Where the current pickup_state came from (matches the migration CHECK). */
export type PickupSource = "WEBHOOK" | "RECONCILIATION" | "MANUAL_REFRESH" | "STAFF_ACTION" | "BOOKING_RESPONSE";

export interface RefreshOrder {
  id: string;
  status: string;
}

export interface RefreshShipment extends LocalShipmentRow {
  id: string;
}

export interface PickupActor {
  id?: string | null;
  name?: string | null;
}

export interface ShipmentPickupPatch {
  pickup_state: PickupState;
  pickup_status_source: PickupSource;
  pickup_last_synced_at: string;
  provider_pickup_status?: string | null;
  provider_pickup_status_at?: string;
  /** Case B only: the shipment/AWB itself is cancelled and must be superseded. */
  status?: string;
  pickup_cancelled_at?: string;
  pickup_cancel_reason?: string | null;
}

export interface PickupSyncEventInput {
  fromStatus: string;
  toStatus: string;
  basis: string;
  pickupState: PickupState;
  reason: string | null;
  cancelShipment: boolean;
  source: PickupSource;
}

/**
 * The three writes the reconciliation needs, each conditional/idempotent. `advanceOrder`
 * must be an optimistic update (`where status = from`) and return whether a row actually
 * changed, so a concurrent transition can't be clobbered (§ two-staff safety, §11, §12).
 */
export interface PickupRefreshIO {
  advanceOrder(from: string, to: string): Promise<boolean>;
  patchShipment(shipmentId: string, patch: ShipmentPickupPatch): Promise<void>;
  recordEvent(orderId: string, input: PickupSyncEventInput, actor: PickupActor): Promise<void>;
}

export interface RefreshOutcome {
  changed: boolean;
  orderStatus: string;
  pickupState: PickupState;
  basis: string;
  /** "stale" when the order moved under us between read and write. */
  note?: "stale";
}

export interface PickupPlan extends ReconcileResult {
  basis?: string;
}

/** Persist an already-decided reconciliation plan. The single write path for all callers. */
export async function persistPickupPlan(
  order: RefreshOrder,
  shipment: { id: string; pickupState?: PickupState; providerStatus?: string | null },
  plan: PickupPlan,
  actor: PickupActor,
  io: PickupRefreshIO,
  source: PickupSource,
  now: () => string = () => new Date().toISOString(),
): Promise<RefreshOutcome> {
  const current = shipment.pickupState ?? "NOT_REQUESTED";
  const basis = plan.basis ?? (plan.cancelShipment ? "shipment_cancelled" : "provider_signal");

  if (!plan.changed) {
    return { changed: false, orderStatus: order.status, pickupState: current, basis };
  }

  const nextOrderStatus = plan.orderStatus ?? order.status;

  // Advance the order first, under an optimistic lock. If the status already moved (another
  // staff action, a webhook, or the cron), abandon the whole repair rather than overwrite it.
  if (nextOrderStatus !== order.status) {
    const moved = await io.advanceOrder(order.status, nextOrderStatus);
    if (!moved) {
      return { changed: false, orderStatus: order.status, pickupState: current, basis, note: "stale" };
    }
  }

  const stamp = now();
  const patch: ShipmentPickupPatch = {
    pickup_state: plan.pickupState,
    pickup_status_source: source,
    pickup_last_synced_at: stamp,
    ...(shipment.providerStatus !== undefined
      ? { provider_pickup_status: shipment.providerStatus ?? null, provider_pickup_status_at: stamp }
      : {}),
    ...(plan.cancelShipment
      ? { status: "cancelled", pickup_cancelled_at: stamp, pickup_cancel_reason: plan.reason ?? null }
      : {}),
  };
  await io.patchShipment(shipment.id, patch);

  await io.recordEvent(
    order.id,
    {
      fromStatus: order.status,
      toStatus: nextOrderStatus,
      basis,
      pickupState: plan.pickupState,
      reason: plan.reason ?? null,
      cancelShipment: plan.cancelShipment,
      source,
    },
    actor,
  );

  return { changed: true, orderStatus: nextOrderStatus, pickupState: plan.pickupState, basis };
}

/**
 * Self-heal one order from the shipment's *stored* truth (AWB + persisted provider wording).
 * Used by the cron and by the in-session stored-evidence repair. Includes the booking floor
 * (AWB present but order behind → READY_FOR_PICKUP).
 */
export async function applyPickupRefresh(
  order: RefreshOrder,
  shipment: RefreshShipment,
  actor: PickupActor,
  io: PickupRefreshIO,
  now: () => string = () => new Date().toISOString(),
  source: PickupSource = "MANUAL_REFRESH",
): Promise<RefreshOutcome> {
  const plan = planLocalRepair({ status: order.status }, shipment);
  return persistPickupPlan(
    order,
    { id: shipment.id, pickupState: shipment.pickupState, providerStatus: shipment.pickupStatusRaw ?? shipment.trackingStatus ?? null },
    plan,
    actor,
    io,
    source,
    now,
  );
}

/**
 * Reconcile from a *fresh provider signal* (webhook payload or a successful live read).
 * The raw string is normalized once, here, so webhook/cron/manual all agree (§12). Falls
 * back to the booking floor so a booked-but-stuck order is also healed by the same call.
 */
export async function reconcilePickupFromProvider(
  order: RefreshOrder,
  shipment: RefreshShipment,
  rawStatus: string | null,
  rawRemark: string | null,
  actor: PickupActor,
  io: PickupRefreshIO,
  source: PickupSource,
  now: () => string = () => new Date().toISOString(),
): Promise<RefreshOutcome> {
  const fact = normalizeCourierPickupStatus({ provider: shipment.provider, rawStatus, rawRemark });
  const signalPlan = reconcileCourierShipment(
    { status: order.status },
    { awb: shipment.awb, active: shipment.active, pickupState: shipment.pickupState ?? "NOT_REQUESTED" },
    { awb: shipment.awb, pickupState: fact.pickupState, shipmentCancelled: fact.shipmentCancelled, reason: fact.reason },
  );
  // An explicit pickup signal wins; otherwise fall back to the booking floor (AWB present,
  // order behind) so an order that was booked without a confirmed pickup is still healed.
  const plan: PickupPlan = signalPlan.changed || (signalPlan.ignored && signalPlan.ignored !== "no_signal")
    ? signalPlan
    : planLocalRepair({ status: order.status }, { ...shipment, trackingStatus: rawStatus ?? shipment.trackingStatus });
  return persistPickupPlan(
    order,
    { id: shipment.id, pickupState: shipment.pickupState, providerStatus: rawStatus ?? null },
    plan,
    actor,
    io,
    source,
    now,
  );
}

/** Build the Supabase-backed IO used by every server path, so the writes are identical. */
export function makeSupabasePickupIO(db: SupabaseClient, orderId: string): PickupRefreshIO {
  const iso = () => new Date().toISOString();
  return {
    async advanceOrder(from, to) {
      const { data } = await db.from("store_orders").update({ status: to, updated_at: iso() }).eq("id", orderId).eq("status", from).select("id");
      return Array.isArray(data) && data.length > 0;
    },
    async patchShipment(shipmentId, patch) {
      await db.from("store_shipments").update({ ...patch, updated_at: iso() }).eq("id", shipmentId);
    },
    async recordEvent(id, input, who) {
      await db.from("store_order_events").insert({
        order_id: id,
        event: "courier_pickup_synced",
        from_status: input.fromStatus,
        to_status: input.toStatus,
        actor_type: input.source === "WEBHOOK" || input.source === "RECONCILIATION" ? "system" : "admin",
        actor_id: who.id ?? null,
        actor_name: who.name ?? null,
        payload_json: {
          basis: input.basis,
          pickup_state: input.pickupState,
          cancel_shipment: input.cancelShipment,
          reason: input.reason,
          source: input.source,
        },
      });
    },
  };
}

/** Narrow a shipment row (any shape) into the reconciler's provider type. */
export function toCourierProvider(value: unknown): CourierProvider {
  return value === "delhivery" || value === "shiprocket" ? value : "manual";
}
