import { cookies } from "next/headers";
import { storeDb } from "@/lib/store/db";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";
import { getPublicOrder } from "@/lib/store/orders";
import {
  STORE_ORDER_ACCESS_COOKIE,
  encodeOrderAccessCookie,
  hashStoreAccessToken,
  mintStoreAccessToken,
  storeOrderAccessCookieOptions,
} from "@/lib/store/accessToken";
import { clientIp, storeRateLimited } from "@/lib/store/rateLimit";

export const dynamic = "force-dynamic";

function digits10(phone: string): string {
  return (phone || "").replace(/\D/g, "").slice(-10);
}

const LOOKUP_FAIL = { ok: false, error: "No order matches that number and phone" } as const;

/**
 * Phone + order_no proof of possession. Mints a fresh access token (hash only in
 * DB), sets the httpOnly cookie, and returns PublicOrder with the raw token once
 * for client Verify polling.
 */
export async function POST(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  if (await storeRateLimited(`notes-track:${clientIp(req)}`, 20, 600)) {
    return noStoreJson({ ok: false, error: "Too many attempts. Please wait a few minutes." }, 429);
  }
  const db = storeDb();
  if (!db) return noStoreJson({ ok: false, error: "unavailable" }, 503);
  const body = (await req.json()) as { order_no?: string; phone?: string };
  const orderNo = (body.order_no || "").trim().toUpperCase();
  const phone = digits10(body.phone || "");
  if (!orderNo || phone.length !== 10) {
    return noStoreJson(LOOKUP_FAIL, 404);
  }
  const { data: order } = await db
    .from("store_orders")
    .select("id,order_no,phone_key")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (!order || order.phone_key !== phone) {
    return noStoreJson(LOOKUP_FAIL, 404);
  }

  const raw = mintStoreAccessToken();
  const { error: hashErr } = await db
    .from("store_orders")
    .update({
      tracking_token_hash: hashStoreAccessToken(raw),
      tracking_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);
  if (hashErr) return noStoreJson({ ok: false, error: "unavailable" }, 503);

  cookies().set(
    STORE_ORDER_ACCESS_COOKIE,
    encodeOrderAccessCookie(order.order_no, raw),
    storeOrderAccessCookieOptions(new URL(req.url).hostname),
  );

  const publicOrder = await getPublicOrder(order.order_no, { trackingToken: raw });
  if (!publicOrder) return noStoreJson(LOOKUP_FAIL, 404);
  return noStoreJson({ ok: true, order: publicOrder });
}
