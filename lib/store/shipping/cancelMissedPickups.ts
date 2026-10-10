/**
 * Cancel Delhivery waybills the carrier never collected, then return those orders
 * to Packed through the same reconciliation used by a staff courier change.
 * A failed or empty provider read changes nothing. A parcel the carrier already
 * has is left alone. This does not book a replacement.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelProviderShipment } from "./book";
import { trackDelhiveryAwb } from "./delhiveryApi";
import {
  carrierAwaitingPickup,
  carrierHasPossession,
  carrierShipmentCancelled,
  missedDelhiveryPickup,
  type MissedPickupInput,
} from "./missedPickup";
import type { PickupState } from "./pickup";
import { makeSupabasePickupIO, reconcilePickupFromProvider } from "./refreshPickup";

export interface MissedPickupCandidate extends MissedPickupInput {
  orderId: string;
  shipmentId: string;
  awb: string;
  pickupState: PickupState;
}

export interface MissedPickupRepairResult {
  considered: number;
  cancelled: number;
  alreadyCancelled: number;
  skipped: number;
  errors: number;
}

export async function retireMissedDelhiveryPickups(input: {
  candidates: MissedPickupCandidate[];
  nowIso: string;
  readLive: (awb: string) => Promise<{ rawStatus: string | null; possessed: boolean }>;
  cancelAwb: (awb: string) => Promise<void>;
  retireLocal: (row: MissedPickupCandidate, liveStatus: string) => Promise<boolean>;
}): Promise<MissedPickupRepairResult> {
  const result: MissedPickupRepairResult = { considered: 0, cancelled: 0, alreadyCancelled: 0, skipped: 0, errors: 0 };
  for (const row of input.candidates) {
    if (!missedDelhiveryPickup(row, input.nowIso)) continue;
    result.considered += 1;
    try {
      const live = await input.readLive(row.awb);
      if (!live.rawStatus || live.possessed || carrierHasPossession(live.rawStatus)) {
        result.skipped += 1;
        continue;
      }
      if (carrierShipmentCancelled(live.rawStatus)) {
        const retired = await input.retireLocal(row, live.rawStatus);
        if (retired) result.alreadyCancelled += 1;
        else result.skipped += 1;
        continue;
      }
      if (!carrierAwaitingPickup(live.rawStatus) || !missedDelhiveryPickup({ ...row, trackingStatus: live.rawStatus }, input.nowIso)) {
        result.skipped += 1;
        continue;
      }
      await input.cancelAwb(row.awb);
      const retired = await input.retireLocal(row, live.rawStatus);
      if (retired) result.cancelled += 1;
      else result.errors += 1;
    } catch {
      result.errors += 1;
    }
  }
  return result;
}

/** Production repair. Uses the live Delhivery read and the audited pickup reconciler. */
export async function runMissedDelhiveryPickupRepair(
  db: SupabaseClient,
  nowIso = new Date().toISOString(),
): Promise<MissedPickupRepairResult> {
  const empty = { considered: 0, cancelled: 0, alreadyCancelled: 0, skipped: 0, errors: 0 };
  const { data: orders, error } = await db
    .from("store_orders")
    .select("id,status")
    .eq("fulfillment_method", "DELIVERY")
    .in("status", ["READY_FOR_PICKUP", "PICKUP_SCHEDULED"])
    .limit(80);
  if (error) return { ...empty, errors: 1 };
  if (!orders?.length) return empty;

  const statusById = new Map(orders.map((order) => [order.id as string, order.status as string]));
  const { data: ships, error: shipError } = await db
    .from("store_shipments")
    .select("id,order_id,awb,status,pickup_state,pickup_scheduled_at,created_at,provider_payload")
    .eq("provider", "delhivery")
    .in("status", ["pending", "created", "manifested"])
    .in("order_id", [...statusById.keys()])
    .limit(40);
  if (shipError) return { ...empty, errors: 1 };

  const candidates: MissedPickupCandidate[] = [];
  for (const ship of ships || []) {
    const awb = typeof ship.awb === "string" ? ship.awb.trim() : "";
    if (!awb) continue;
    const payload = (ship.provider_payload && typeof ship.provider_payload === "object" ? ship.provider_payload : {}) as {
      tracking_status?: string;
    };
    const row: MissedPickupCandidate = {
      orderId: ship.order_id,
      shipmentId: ship.id,
      awb,
      provider: "delhivery",
      shipmentStatus: ship.status,
      trackingStatus: payload.tracking_status || null,
      pickupScheduledAt: ship.pickup_scheduled_at,
      createdAt: ship.created_at,
      orderStatus: statusById.get(ship.order_id) || "",
      pickupState: (ship.pickup_state as PickupState) || "NOT_REQUESTED",
    };
    if (missedDelhiveryPickup(row, nowIso)) candidates.push(row);
  }

  return retireMissedDelhiveryPickups({
    candidates,
    nowIso,
    readLive: async (awb) => trackDelhiveryAwb(awb),
    cancelAwb: async (awb) => {
      await cancelProviderShipment({ provider: "delhivery", awb });
    },
    retireLocal: async (row, liveStatus) => {
      const { data: order } = await db.from("store_orders").select("id,status,fulfillment_method").eq("id", row.orderId).maybeSingle();
      if (!order || order.fulfillment_method !== "DELIVERY") return false;
      if (order.status !== "READY_FOR_PICKUP" && order.status !== "PICKUP_SCHEDULED") return false;
      const { data: current } = await db.from("store_shipments").select("id,status,awb").eq("id", row.shipmentId).maybeSingle();
      if (!current?.awb || current.status === "cancelled" || current.status === "picked_up" || current.status === "in_transit") return false;
      const outcome = await reconcilePickupFromProvider(
        { id: order.id, status: order.status },
        {
          id: row.shipmentId,
          provider: "delhivery",
          awb: row.awb,
          shipmentStatus: current.status,
          trackingStatus: liveStatus,
          pickupState: row.pickupState,
          active: true,
        },
        "Shipment Cancelled",
        liveStatus,
        { name: "reconciliation" },
        makeSupabasePickupIO(db, order.id),
        "RECONCILIATION",
      );
      return outcome.orderStatus === "PACKED" || outcome.changed;
    },
  });
}
