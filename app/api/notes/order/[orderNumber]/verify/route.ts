import { applyStoreVerify } from "@/lib/store/payments/verify";
import { isStoreOpen } from "@/lib/store/payments/status";
import { getPublicOrder } from "@/lib/store/orders";
import { storeDb } from "@/lib/store/db";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";
import { verifyRawTokenAgainstHash } from "@/lib/store/accessToken";
import { clientIp, storeRateLimited } from "@/lib/store/rateLimit";

export const dynamic = "force-dynamic";

const lastVerifyAt = new Map<string, number>();
const MIN_GAP_MS = 2500;

const NOT_FOUND = { ok: false, error: "not found" } as const;

/**
 * Store-owned Verify trigger for the order page. The cron alone is too slow for
 * a customer waiting after the Eazypay redirect. Terminal writes still go only
 * through applyStoreVerify. Requires the raw access token whose hash matches.
 */
export async function POST(req: Request, { params }: { params: { orderNumber: string } }) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  if (await storeRateLimited(`notes-verify:${clientIp(req)}`, 40, 600)) {
    return noStoreJson({ ok: false, error: "Too many attempts. Please wait a moment." }, 429);
  }
  const db = storeDb();
  if (!db) return noStoreJson({ ok: false, error: "unavailable" }, 503);

  const orderNo = decodeURIComponent(params.orderNumber || "").trim().toUpperCase();
  if (!orderNo) return noStoreJson(NOT_FOUND, 404);

  let token = "";
  try {
    const body = (await req.json()) as { t?: string; access_token?: string };
    token = String(body.t || body.access_token || "").trim();
  } catch {
    token = "";
  }
  if (!token) return noStoreJson(NOT_FOUND, 404);

  const { data: order } = await db
    .from("store_orders")
    .select("id,order_no,tracking_token_hash")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (!order || !verifyRawTokenAgainstHash(token, order.tracking_token_hash)) {
    return noStoreJson(NOT_FOUND, 404);
  }

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

  const publicOrder = await getPublicOrder(order.order_no, { trackingToken: token });
  return noStoreJson({ ok: true, order: publicOrder, verify });
}
