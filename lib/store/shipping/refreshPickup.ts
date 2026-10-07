/**
 * Apply a courier pickup reconciliation to one order through the audited write path.
 *
 * This is the runtime counterpart of {@link planLocalRepair}: it takes an order + its
 * active shipment, asks the pure planner for the safe transition, and — only when a
 * change is warranted — advances the order status (optimistically locked), stamps the
 * shipment's pickup lifecycle columns, and records a `courier_pickup_synced` audit event.
 *
 * The database is injected as three narrow operations so the decision + ordering can be
 * unit-tested without Supabase, and so the same logic serves the "Refresh courier status"
 * admin action and any future cron reconciliation. It never calls a provider.
 */
import { planLocalRepair, type LocalShipmentRow, type PickupState } from "./pickup";

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
  pickup_status_source: "MANUAL_REFRESH";
  pickup_last_synced_at: string;
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
}

/**
 * The three writes the reconciliation needs, each conditional/idempotent. `advanceOrder`
 * must be an optimistic update (`where status = from`) and return whether a row actually
 * changed, so a concurrent transition can't be clobbered (§ two-staff safety).
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

export async function applyPickupRefresh(
  order: RefreshOrder,
  shipment: RefreshShipment,
  actor: PickupActor,
  io: PickupRefreshIO,
  now: () => string = () => new Date().toISOString(),
): Promise<RefreshOutcome> {
  const current = shipment.pickupState ?? "NOT_REQUESTED";
  const plan = planLocalRepair({ status: order.status }, shipment);

  if (!plan.changed) {
    return { changed: false, orderStatus: order.status, pickupState: current, basis: plan.basis };
  }

  const nextOrderStatus = plan.orderStatus ?? order.status;

  // Advance the order first, under an optimistic lock. If the status already moved (another
  // staff action or a webhook), abandon the whole repair rather than overwrite it.
  if (nextOrderStatus !== order.status) {
    const moved = await io.advanceOrder(order.status, nextOrderStatus);
    if (!moved) {
      return { changed: false, orderStatus: order.status, pickupState: current, basis: plan.basis, note: "stale" };
    }
  }

  const stamp = now();
  const patch: ShipmentPickupPatch = {
    pickup_state: plan.pickupState,
    pickup_status_source: "MANUAL_REFRESH",
    pickup_last_synced_at: stamp,
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
      basis: plan.basis,
      pickupState: plan.pickupState,
      reason: plan.reason ?? null,
      cancelShipment: plan.cancelShipment,
    },
    actor,
  );

  return { changed: true, orderStatus: nextOrderStatus, pickupState: plan.pickupState, basis: plan.basis };
}
