import { cookies } from "next/headers";
import { getCartView } from "@/lib/store/cart";
import { placeCheckout, type CheckoutAddress } from "@/lib/store/checkout";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";
import {
  STORE_ORDER_ACCESS_COOKIE,
  encodeOrderAccessCookie,
  storeOrderAccessCookieOptions,
} from "@/lib/store/accessToken";
import { clientIp, storeRateLimited } from "@/lib/store/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  if (await storeRateLimited(`notes-checkout:${clientIp(req)}`, 12, 600)) {
    return noStoreJson({ ok: false, error: "Too many attempts. Please wait a few minutes." }, 429);
  }
  try {
    const cart = await getCartView();
    if (!cart || !cart.items.length) return noStoreJson({ ok: false, error: "Your cart is empty" }, 400);
    const body = (await req.json()) as CheckoutAddress;
    const result = await placeCheckout(cart, body);
    cookies().set(
      STORE_ORDER_ACCESS_COOKIE,
      encodeOrderAccessCookie(result.order_no, result.access_token),
      storeOrderAccessCookieOptions(new URL(req.url).hostname),
    );
    // Never return the raw token in the JSON body (analytics/devtools). Cookie only.
    const { access_token: _omit, ...safe } = result;
    return noStoreJson({ ok: true, ...safe });
  } catch (e) {
    return noStoreJson({ ok: false, error: (e as Error).message }, 400);
  }
}
