import { storeDb } from "./db";
import { customerShipTo } from "./address";
import { projectCustomerStage, customerStageLabel, trackingSteps, type CustomerStage } from "./projection";
import { formatPaise } from "./money";
import { verifyRawTokenAgainstHash } from "./accessToken";

/** Staff queue label. A local test fixture must not read as a live capture. */
export function staffPaymentLabel(provider: string | null | undefined, status: string | null | undefined): string | null {
  if (provider === "TEST_FIXTURE") return "TEST — simulated, no gateway charge";
  return status || null;
}

export interface PublicOrder {
  order_no: string;
  stage: CustomerStage;
  stage_label: string;
  placed_at: string;
  promised_delivery_date: string | null;
  total_label: string;
  offer_id: string | null;
  items: { name: string; qty: number; total: string }[];
  ship_to: string | null;
  awb: string | null;
  courier: string | null;
  steps: ReturnType<typeof trackingSteps>;
  pickup_note?: string | null;
  /** True while EazyPGVerify has not yet written a terminal. */
  confirming: boolean;
  /**
   * Echo of the caller-provided raw access token so the client can poll Verify.
   * Never loaded from the database (only the hash is stored).
   */
  access_token?: string;
}

/**
 * Public order projection. Requires the raw access token whose hash matches
 * store_orders.tracking_token_hash so sequential NIAS-N- numbers cannot enumerate.
 */
export async function getPublicOrder(
  orderNo: string,
  opts: { trackingToken: string },
): Promise<PublicOrder | null> {
  const token = (opts.trackingToken || "").trim();
  if (!token) return null;
  const db = storeDb();
  if (!db) return null;
  const { data: order } = await db
    .from("store_orders")
    .select("id,order_no,status,placed_at,promised_delivery_date,total_paise,tracking_token_hash,shipping_address_id,offer_id")
    .eq("order_no", orderNo.trim().toUpperCase())
    .maybeSingle();
  if (!order || !verifyRawTokenAgainstHash(token, order.tracking_token_hash)) return null;

  const { data: items } = await db
    .from("store_order_items")
    .select("name_snapshot,qty,line_total_paise")
    .eq("order_id", order.id);
  const { data: shipRows } = await db
    .from("store_shipments")
    .select("awb,courier_name,status,provider_payload")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false });
  const ship = (shipRows || []).find((row) => row.status !== "cancelled" && row.status !== "failed") || null;
  let shipTo: string | null = null;
  if (order.shipping_address_id) {
    const { data: addr } = await db
      .from("store_addresses")
      .select("line1,line2,city,state,pincode")
      .eq("id", order.shipping_address_id)
      .maybeSingle();
    if (addr) shipTo = customerShipTo(addr);
  }
  const hasAwb = !!(ship?.awb);
  const payload = (ship?.provider_payload && typeof ship.provider_payload === "object" ? ship.provider_payload : {}) as {
    tracking_activity?: string;
    pickup_status?: string;
    pickup_reattempt_date?: string;
  };
  const pickupMissed = order.status === "PICKUP_SCHEDULED" && /not done|pickup exception|pickup failed/i.test(payload.tracking_activity || "");
  const pickupQueued = payload.pickup_status === "already_in_pickup_queue" || payload.pickup_status === "reattempt_requested";
  const pickupDelayed = pickupMissed && !pickupQueued;
  const stage = projectCustomerStage(order.status, hasAwb);
  return {
    order_no: order.order_no,
    stage,
    placed_at: order.placed_at,
    promised_delivery_date: order.promised_delivery_date,
    total_label: formatPaise(order.total_paise),
    offer_id: order.offer_id || null,
    items: (items || []).map((i) => ({ name: i.name_snapshot, qty: i.qty, total: formatPaise(i.line_total_paise) })),
    ship_to: shipTo,
    awb: hasAwb ? ship!.awb : null,
    courier: hasAwb ? ship!.courier_name : null,
    steps: trackingSteps(stage, hasAwb).map((step) =>
      step.id === "packed" && order.status === "PICKUP_SCHEDULED"
        ? { ...step, label: pickupDelayed ? "Pickup delayed" : "Pickup scheduled" }
        : step,
    ),
    stage_label: pickupDelayed ? "Pickup delayed" : order.status === "PICKUP_SCHEDULED" ? "Pickup scheduled" : customerStageLabel(stage),
    pickup_note: pickupDelayed
      ? "Courier collection is being rescheduled."
      : order.status === "PICKUP_SCHEDULED"
        ? "Courier collection is pending."
        : null,
    confirming: stage === "pending",
    access_token: token,
  };
}
