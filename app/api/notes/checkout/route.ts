import { getCartView } from "@/lib/store/cart";
import { placeCheckout, type CheckoutAddress } from "@/lib/store/checkout";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  try {
    const cart = await getCartView();
    if (!cart || !cart.items.length) return noStoreJson({ ok: false, error: "Your cart is empty" }, 400);
    const body = (await req.json()) as CheckoutAddress;
    const result = await placeCheckout(cart, body);
    return noStoreJson({ ok: true, ...result });
  } catch (e) {
    return noStoreJson({ ok: false, error: (e as Error).message }, 400);
  }
}
