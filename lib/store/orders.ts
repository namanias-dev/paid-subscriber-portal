import { storeDb } from "./db";
import { customerShipTo } from "./address";
import { activeCustomerShipment } from "./deliveryAddress";
import { projectCustomerStage, customerStageLabel, trackingSteps, type CustomerStage } from "./projection";
import { formatPaise } from "./money";
import { verifyRawTokenAgainstHash } from "./accessToken";
import { toPublicIssue, type PublicIssue } from "./issues";
import { safeCourierTrackUrl } from "./trackingView";
import { orderMethod, type FulfillmentMethod } from "./fulfillment";
import { readPickupSnapshot, type PickupLocationSnapshot } from "./pickupLocation";

/** Customer location the buyer gave for an Academy Pickup order (never the academy). */
export interface PublicCustomerLocation {
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export function readCustomerLocation(value: unknown): PublicCustomerLocation | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const text = (key: string) => (typeof v[key] === "string" && (v[key] as string).trim() ? (v[key] as string).trim() : null);
  const location = { city: text("city"), state: text("state"), pincode: text("pincode") };
  return location.city || location.state || location.pincode ? location : null;
}

/** Staff queue label. A local test fixture must not read as a live capture. */
export function staffPaymentLabel(provider: string | null | undefined, status: string | null | undefined): string | null {
  if (provider === "TEST_FIXTURE") return "TEST — simulated, no gateway charge";
  return status || null;
}

export interface PublicOrder {
  order_no: string;
  /** Absent on older cached payloads: treat as DELIVERY. */
  fulfillment_method?: FulfillmentMethod;
  /** Academy Pickup only: the frozen location promised at checkout. */
  pickup_location?: PickupLocationSnapshot | null;
  ready_for_collection_at?: string | null;
  collected_at?: string | null;
  customer_location?: PublicCustomerLocation | null;
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
  invoice_number?: string | null;
  invoice_status?: string | null;
  invoice_document?: string | null;
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
  opts: { trackingToken: string; /** Tests only. */ db?: ReturnType<typeof storeDb> },
): Promise<PublicOrder | null> {
  const token = (opts.trackingToken || "").trim();
  if (!token) return null;
  const db = opts.db ?? storeDb();
  if (!db) return null;
  const { data: order } = await db
    .from("store_orders")
    .select(
      "id,order_no,status,placed_at,promised_delivery_date,subtotal_paise,discount_paise,shipping_paise,total_paise,promo_code,discount_trace_json,tracking_token_hash,shipping_address_id,offer_id,shipped_at,delivered_at,fulfillment_method,pickup_location_snapshot,ready_for_collection_at,collected_at,customer_location_snapshot",
    )
    .eq("order_no", orderNo.trim().toUpperCase())
    .maybeSingle();
  if (!order || !verifyRawTokenAgainstHash(token, order.tracking_token_hash)) return null;

  const { data: items } = await db
    .from("store_order_items")
    .select("name_snapshot,qty,line_total_paise")
    .eq("order_id", order.id);
  if (orderMethod(order) === "ACADEMY_PICKUP") return pickupPublicOrder(db, order, items || [], token);
  const { data: shipRows } = await db
    .from("store_shipments")
    .select("awb,courier_name,status,provider_payload,tracking_url")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false });
  const ship = activeCustomerShipment(shipRows || []);
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
  const { data: invoice } = await db
    .from("store_invoices")
    .select("invoice_number,status,document_type")
    .eq("order_id", order.id)
    .maybeSingle();
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
        ? { ...step, label: pickupDelayed ? "Courier pickup delayed" : "Courier pickup scheduled" }
        : step,
    ),
    stage_label: pickupDelayed ? "Courier pickup delayed" : order.status === "PICKUP_SCHEDULED" ? "Courier pickup scheduled" : customerStageLabel(stage),
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
    invoice_number: invoice?.invoice_number || null,
    invoice_status: invoice?.status || null,
    invoice_document: invoice?.document_type || null,
    confirming: stage === "pending",
    access_token: token,
  };
}

type StoreDb = NonNullable<ReturnType<typeof storeDb>>;

const PICKUP_STEP_STAGE: Record<"confirmed" | "preparing" | "printing" | "ready" | "collected", CustomerStage> = {
  confirmed: "confirmed",
  preparing: "preparing",
  printing: "printing",
  ready: "ready_for_collection",
  collected: "collected",
};

/** Academy Pickup projection: no shipment read, no courier, AWB, address or delivery promise. */
async function pickupPublicOrder(
  db: StoreDb,
  order: Record<string, any>,
  items: Array<{ name_snapshot: string; qty: number; line_total_paise: number }>,
  token: string,
): Promise<PublicOrder> {
  const { buildPickupTimeline } = await import("./pickupTracking");
  const trace = (order.discount_trace_json && typeof order.discount_trace_json === "object" ? order.discount_trace_json : {}) as { offer_name?: string };
  const [{ data: issueRows, error: issueError }, { data: invoice }] = await Promise.all([
    db
      .from("store_order_issues")
      .select("reference,category,description,status,created_at,updated_at,customer_note,callback_requested")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(5),
    db.from("store_invoices").select("invoice_number,status,document_type").eq("order_id", order.id).maybeSingle(),
  ]);
  const stage = projectCustomerStage(order.status, false);
  const timeline = buildPickupTimeline({
    stage,
    placedAt: order.placed_at,
    readyAt: order.ready_for_collection_at,
    collectedAt: order.collected_at,
  });
  return {
    order_no: order.order_no,
    fulfillment_method: "ACADEMY_PICKUP",
    pickup_location: readPickupSnapshot(order.pickup_location_snapshot),
    ready_for_collection_at: order.ready_for_collection_at || null,
    collected_at: order.collected_at || null,
    customer_location: readCustomerLocation(order.customer_location_snapshot),
    stage,
    stage_label: customerStageLabel(stage),
    placed_at: order.placed_at,
    promised_delivery_date: null,
    total_label: formatPaise(order.total_paise),
    offer_id: order.offer_id || null,
    items: items.map((i) => ({ name: i.name_snapshot, qty: i.qty, total: formatPaise(i.line_total_paise) })),
    subtotal_label: order.subtotal_paise ? formatPaise(order.subtotal_paise) : null,
    discount_label: order.discount_paise ? formatPaise(order.discount_paise) : null,
    discount_name: trace.offer_name || order.promo_code || null,
    shipping_label: "Free",
    ship_to: null,
    awb: null,
    courier: null,
    courier_track_url: null,
    steps: timeline.map((step) => ({ id: PICKUP_STEP_STAGE[step.id], label: step.label, done: step.state === "done" || step.state === "current", skipped: false })),
    pickup_note: null,
    pickup_delayed: false,
    pickup_queued: false,
    order_status: order.status,
    shipped_at: null,
    delivered_at: null,
    event_at: null,
    issues: issueError ? [] : (issueRows || []).map((row) => toPublicIssue(row)),
    invoice_number: invoice?.invoice_number || null,
    invoice_status: invoice?.status || null,
    invoice_document: invoice?.document_type || null,
    confirming: stage === "pending",
    access_token: token,
  };
}
