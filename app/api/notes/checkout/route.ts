import { cookies } from "next/headers";
import { getCartView } from "@/lib/store/cart";
import { placeCheckout, placePickupCheckout, type CheckoutAddress } from "@/lib/store/checkout";
import { PickupCheckoutError } from "@/lib/store/pickupCheckoutRules";
import { parseFulfillmentMethod } from "@/lib/store/fulfillment";
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
    const body = (await req.json()) as CheckoutAddress & { fulfillment_method?: unknown };
    // The request names its own method; the cart's draft choice is never consulted.
    // Absent means DELIVERY (pages loaded before Academy Pickup existed).
    const method = body.fulfillment_method == null ? "DELIVERY" : parseFulfillmentMethod(body.fulfillment_method);
    if (!method) return noStoreJson({ ok: false, error: "Choose Delivery or Academy Pickup." }, 400);
    const result = method === "ACADEMY_PICKUP" ? await placePickupCheckout(cart, body) : await placeCheckout(cart, body);
    cookies().set(
      STORE_ORDER_ACCESS_COOKIE,
      encodeOrderAccessCookie(result.order_no, result.access_token),
      storeOrderAccessCookieOptions(new URL(req.url).hostname),
    );
    // Never return the raw token in the JSON body (analytics/devtools). Cookie only.
    const { access_token: _omit, ...safe } = result;
    return noStoreJson({ ok: true, ...safe });
  } catch (e) {
    if (e instanceof PickupCheckoutError) {
      console.info(`[store/fulfillment] pickup_checkout_refused ${JSON.stringify({ code: e.code, fulfillment_method: "ACADEMY_PICKUP" })}`);
      return noStoreJson({ ok: false, error: e.message, code: e.code, field: e.field, retriable: e.status === 503 }, e.status);
    }
    return noStoreJson({ ok: false, error: (e as Error).message }, 400);
  }
}
