import { storeDb } from "@/lib/store/db";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";
import { projectCustomerStage, customerStageLabel, trackingSteps } from "@/lib/store/projection";
import { formatPaise } from "@/lib/store/money";

export const dynamic = "force-dynamic";

function digits10(phone: string): string {
  return (phone || "").replace(/\D/g, "").slice(-10);
}

export async function POST(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  const db = storeDb();
  if (!db) return noStoreJson({ ok: false, error: "unavailable" }, 503);
  const body = (await req.json()) as { order_no?: string; phone?: string };
  const orderNo = (body.order_no || "").trim().toUpperCase();
  const phone = digits10(body.phone || "");
  if (!orderNo || phone.length !== 10) {
    return noStoreJson({ ok: false, error: "Order number and 10-digit phone are required" }, 400);
  }
  const { data: order } = await db
    .from("store_orders")
    .select("id,order_no,status,customer_name,placed_at,promised_delivery_date,total_paise,phone_key")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (!order || order.phone_key !== phone) {
    return noStoreJson({ ok: false, error: "No order matches that number and phone" }, 404);
  }
  const { data: items } = await db
    .from("store_order_items")
    .select("name_snapshot,qty,line_total_paise")
    .eq("order_id", order.id);
  const { data: ship } = await db
    .from("store_shipments")
    .select("awb,courier_name,status")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const hasAwb = !!(ship?.awb);
  const stage = projectCustomerStage(order.status, hasAwb);
  return noStoreJson({
    ok: true,
    order: {
      order_no: order.order_no,
      stage,
      stage_label: customerStageLabel(stage),
      placed_at: order.placed_at,
      promised_delivery_date: order.promised_delivery_date,
      total_label: formatPaise(order.total_paise),
      items: (items || []).map((i) => ({ name: i.name_snapshot, qty: i.qty, total: formatPaise(i.line_total_paise) })),
      awb: hasAwb ? ship?.awb : null,
      courier: hasAwb ? ship?.courier_name : null,
      steps: trackingSteps(stage, hasAwb),
    },
  });
}
