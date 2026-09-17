import { applyStoreVerify } from "@/lib/store/payments/verify";
import { isStoreOpen } from "@/lib/store/payments/status";
import { getPublicOrder } from "@/lib/store/orders";
import { storeDb } from "@/lib/store/db";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";

export const dynamic = "force-dynamic";

const lastVerifyAt = new Map<string, number>();
const MIN_GAP_MS = 2500;

/**
 * Store-owned Verify trigger for the order page. The daily cron is too slow for
 * a customer waiting after the Eazypay redirect. Terminal writes still go only
 * through applyStoreVerify.
 */
export async function POST(_req: Request, { params }: { params: { orderNumber: string } }) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  const db = storeDb();
  if (!db) return noStoreJson({ ok: false, error: "unavailable" }, 503);

  const orderNo = decodeURIComponent(params.orderNumber || "").trim().toUpperCase();
  if (!orderNo) return noStoreJson({ ok: false, error: "missing order" }, 400);

  const { data: order } = await db
    .from("store_orders")
    .select("id,order_no")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (!order) return noStoreJson({ ok: false, error: "not found" }, 404);

  const { data: payment } = await db
    .from("store_order_payments")
    .select("reference_no,status")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let verify: Awaited<ReturnType<typeof applyStoreVerify>> | null = null;
  if (payment && isStoreOpen(payment.status)) {
    const now = Date.now();
    const prev = lastVerifyAt.get(orderNo) || 0;
    if (now - prev >= MIN_GAP_MS) {
      lastVerifyAt.set(orderNo, now);
      verify = await applyStoreVerify(payment.reference_no, { source: "order-page" });
    }
  }

  const publicOrder = await getPublicOrder(order.order_no);
  return noStoreJson({ ok: true, order: publicOrder, verify });
}
