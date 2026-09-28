import { checkPincode } from "@/lib/store/serviceability";
import { getCartView } from "@/lib/store/cart";
import { buildFrozenQuote } from "@/lib/store/quote";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";
import { formatPaise } from "@/lib/store/money";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  const pin = new URL(req.url).searchParams.get("pin") || "";
  const cart = await getCartView();
  const result = await checkPincode(pin, cart?.max_dispatch_days ?? 2);
  if ("error" in result) return noStoreJson({ ok: false, error: result.error }, 400);

  // When there is a live cart and we can deliver, compute the authoritative
  // order total (subtotal + tax + shipping) exactly as checkout will freeze it,
  // so the customer sees the real amount before the gateway — never a client
  // guess. Best-effort: a stock/pricing change just omits the breakdown and the
  // shipping line still shows.
  let quote: {
    subtotal_paise: number;
    discount_paise: number;
    shipping_paise: number;
    tax_paise: number;
    total_paise: number;
    subtotal_label: string;
    discount_label: string | null;
    shipping_label: string;
    tax_label: string;
    total_label: string;
    offer_name: string | null;
    offer_id: string | null;
    discount_value: number | null;
    discount_type: string | null;
  } | null = null;
  if (cart && cart.items.length && result.serviceable) {
    try {
      const q = await buildFrozenQuote(cart, result);
      quote = {
        subtotal_paise: q.subtotal_paise,
        discount_paise: q.discount_paise,
        shipping_paise: q.shipping_paise,
        tax_paise: q.tax_paise,
        total_paise: q.total_paise,
        subtotal_label: formatPaise(q.subtotal_paise),
        discount_label: q.discount_paise > 0 ? formatPaise(q.discount_paise) : null,
        shipping_label: formatPaise(q.shipping_paise),
        tax_label: formatPaise(q.tax_paise),
        total_label: formatPaise(q.total_paise),
        offer_name: q.offer_name,
        offer_id: q.offer_id,
        discount_value: q.discount_value,
        discount_type: q.discount_type,
      };
    } catch {
      /* leave quote null — shipping_paise below is still accurate */
    }
  }

  return noStoreJson({
    ok: true,
    pincode: result.pincode,
    serviceable: result.serviceable,
    city: result.city,
    state: result.state,
    promised_date: result.promised_date,
    promised_label: result.promised_label,
    shipping_paise: result.zone.shipping_paise,
    quote,
  });
}
