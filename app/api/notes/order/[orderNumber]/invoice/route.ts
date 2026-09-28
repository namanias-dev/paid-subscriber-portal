import { storeDb } from "@/lib/store/db";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";
import { verifyRawTokenAgainstHash } from "@/lib/store/accessToken";
import { invoiceDownloadUrl } from "@/lib/store/invoice/issue";
import { clientIp, storeRateLimited } from "@/lib/store/rateLimit";

export const dynamic = "force-dynamic";

/** Signed invoice download. The token is the same order-access token used for tracking. */
export async function GET(req: Request, { params }: { params: { orderNumber: string } }) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  if (await storeRateLimited(`notes-invoice:${clientIp(req)}`, 30, 600)) {
    return noStoreJson({ ok: false, error: "Please wait a moment and try again." }, 429);
  }
  const db = storeDb();
  if (!db) return noStoreJson({ ok: false, error: "unavailable" }, 503);
  const orderNo = decodeURIComponent(params.orderNumber || "").trim().toUpperCase();
  const token = new URL(req.url).searchParams.get("t") || "";
  if (!orderNo || !token) return noStoreJson({ ok: false, error: "not found" }, 404);
  const { data: order } = await db.from("store_orders").select("id,tracking_token_hash").eq("order_no", orderNo).maybeSingle();
  if (!order || !verifyRawTokenAgainstHash(token, order.tracking_token_hash)) {
    return noStoreJson({ ok: false, error: "not found" }, 404);
  }
  const file = await invoiceDownloadUrl(order.id);
  if (!file) return noStoreJson({ ok: false, error: "The invoice is not ready yet." }, 409);
  return Response.redirect(file.url, 302);
}
