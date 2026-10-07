import { getCartView } from "@/lib/store/cart";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";
import { formatPaise } from "@/lib/store/money";
import { lookupIndianPincode } from "@/lib/store/serviceability";
import { buildPickupQuote } from "@/lib/store/quote";
import { pickupOffer } from "@/lib/store/pickupAvailability";
import { pickupTaxSupported } from "@/lib/store/invoice/placeOfSupply";
import { normalizeIndiaState } from "@/lib/analytics/indiaStates";
import { clientIp, storeRateLimited } from "@/lib/store/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Read-only Academy Pickup preview for checkout: where the PIN is (city/state for the
 * invoice) and the exact total the pickup checkout will freeze. No zone, courier or
 * serviceability input, and nothing is persisted.
 */
export async function GET(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  if (await storeRateLimited(`notes-pickup-quote:${clientIp(req)}`, 60, 600)) {
    return noStoreJson({ ok: false, error: "Too many attempts. Please wait a few minutes.", retriable: true }, 429);
  }
  const offer = await pickupOffer();
  if (!offer.available) {
    return noStoreJson({ ok: false, error: "Academy Pickup isn't available right now. Please choose Delivery.", code: "PICKUP_UNAVAILABLE" }, 409);
  }
  const located = await lookupIndianPincode(new URL(req.url).searchParams.get("pin") || "");
  if (!located.ok) {
    return noStoreJson({ ok: false, error: located.error, retriable: located.retriable }, located.retriable ? 503 : 400);
  }
  const state = normalizeIndiaState(located.state);
  const location = { pincode: located.pincode, city: located.city, state: state.code === "unknown" ? located.state : state.name };
  const cart = await getCartView();
  let quote = null;
  let taxSupported = true;
  if (cart && cart.items.length) {
    try {
      const q = await buildPickupQuote(cart, location, offer.location!.code);
      taxSupported = pickupTaxSupported(q.items);
      quote = {
        subtotal_paise: q.subtotal_paise,
        discount_paise: q.discount_paise,
        shipping_paise: 0,
        tax_paise: q.tax_paise,
        total_paise: q.total_paise,
        subtotal_label: formatPaise(q.subtotal_paise),
        discount_label: q.discount_paise > 0 ? formatPaise(q.discount_paise) : null,
        shipping_label: "Free",
        tax_label: formatPaise(q.tax_paise),
        total_label: formatPaise(q.total_paise),
        offer_name: q.offer_name,
        offer_id: q.offer_id,
      };
    } catch {
      /* a stock/pricing change leaves the preview empty; checkout re-checks */
    }
  }
  return noStoreJson({ ok: true, pincode: location.pincode, city: location.city, state: location.state, tax_supported: taxSupported, quote });
}
