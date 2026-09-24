import { storeDb } from "./db";
import { customerShipTo } from "./address";
import { projectCustomerStage, customerStageLabel, trackingSteps, type CustomerStage } from "./projection";
import { formatPaise } from "./money";
import { verifyRawTokenAgainstHash } from "./accessToken";
import { toPublicIssue, type PublicIssue } from "./issues";
import { safeCourierTrackUrl } from "./trackingView";

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
  subtotal_label: string | null;
  discount_label: string | null;
  discount_name: string | null;
  shipping_label: string | null;
  ship_to: string | null;
  awb: string | null;
  courier: string | null;
  courier_track_url: string | null;
  steps: ReturnType<typeof trackingSteps>;
  pickup_note?: string | null;
  pickup_delayed?: boolean;
  pickup_queued?: boolean;
  order_status?: string;
  shipped_at?: string | null;
  delivered_at?: string | null;
  event_at?: string | null;
  issues?: PublicIssue[];
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
    .select(
      "id,order_no,status,placed_at,promised_delivery_date,subtotal_paise,discount_paise,shipping_paise,total_paise,promo_code,discount_trace_json,tracking_token_hash,shipping_address_id,offer_id,shipped_at,delivered_at",
    )
    .eq("order_no", orderNo.trim().toUpperCase())
    .maybeSingle();
  if (!order || !verifyRawTokenAgainstHash(token, order.tracking_token_hash)) return null;

  const { data: items } = await db
    .from("store_order_items")
    .select("name_snapshot,qty,line_total_paise")
    .eq("order_id", order.id);
  const { data: shipRows } = await db
    .from("store_shipments")
    .select("awb,courier_name,status,provider_payload,tracking_url")
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
    tracking_event_at?: string;
    pickup_status?: string;
    pickup_reattempt_date?: string;
  };
  const trace = (order.discount_trace_json && typeof order.discount_trace_json === "object" ? order.discount_trace_json : {}) as {
    offer_name?: string;
  };
  const { data: issueRows, error: issueError } = await db
    .from("store_order_issues")
    .select("reference,category,description,status,created_at,updated_at,customer_note,callback_requested")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(5);
  const issues = issueError ? [] : (issueRows || []).map((row) => toPublicIssue(row));
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
    subtotal_label: order.subtotal_paise ? formatPaise(order.subtotal_paise) : null,
    discount_label: order.discount_paise ? formatPaise(order.discount_paise) : null,
    discount_name: trace.offer_name || order.promo_code || null,
    shipping_label: order.shipping_paise ? formatPaise(order.shipping_paise) : null,
    ship_to: shipTo,
    awb: hasAwb ? ship!.awb : null,
    courier: hasAwb ? ship!.courier_name : null,
    courier_track_url: hasAwb ? safeCourierTrackUrl(ship!.tracking_url) : null,
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
    pickup_delayed: pickupDelayed,
    pickup_queued: pickupQueued,
    order_status: order.status,
    shipped_at: order.shipped_at || null,
    delivered_at: order.delivered_at || null,
    event_at: payload.tracking_event_at || null,
    issues,
    confirming: stage === "pending",
    access_token: token,
  };
}
