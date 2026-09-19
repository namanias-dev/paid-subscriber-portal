import { storeDb } from "./db";
import { projectCustomerStage, customerStageLabel, trackingSteps, type CustomerStage } from "./projection";
import { formatPaise } from "./money";
import { verifyRawTokenAgainstHash } from "./accessToken";

export interface PublicOrder {
  order_no: string;
  stage: CustomerStage;
  stage_label: string;
  placed_at: string;
  promised_delivery_date: string | null;
  total_label: string;
  items: { name: string; qty: number; total: string }[];
  awb: string | null;
  courier: string | null;
  steps: ReturnType<typeof trackingSteps>;
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
    .select("id,order_no,status,placed_at,promised_delivery_date,total_paise,tracking_token_hash")
    .eq("order_no", orderNo.trim().toUpperCase())
    .maybeSingle();
  if (!order || !verifyRawTokenAgainstHash(token, order.tracking_token_hash)) return null;

  const { data: items } = await db
    .from("store_order_items")
    .select("name_snapshot,qty,line_total_paise")
    .eq("order_id", order.id);
  const { data: ship } = await db
    .from("store_shipments")
    .select("awb,courier_name")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const hasAwb = !!(ship?.awb);
  const stage = projectCustomerStage(order.status, hasAwb);
  return {
    order_no: order.order_no,
    stage,
    stage_label: customerStageLabel(stage),
    placed_at: order.placed_at,
    promised_delivery_date: order.promised_delivery_date,
    total_label: formatPaise(order.total_paise),
    items: (items || []).map((i) => ({ name: i.name_snapshot, qty: i.qty, total: formatPaise(i.line_total_paise) })),
    awb: hasAwb ? ship!.awb : null,
    courier: hasAwb ? ship!.courier_name : null,
    steps: trackingSteps(stage, hasAwb),
    confirming: stage === "pending",
    access_token: token,
  };
}
