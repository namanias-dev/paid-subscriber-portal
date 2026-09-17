import { checkPincode } from "@/lib/store/serviceability";
import { getCartView } from "@/lib/store/cart";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  const pin = new URL(req.url).searchParams.get("pin") || "";
  const cart = await getCartView();
  const result = await checkPincode(pin, cart?.max_dispatch_days ?? 2);
  if ("error" in result) return noStoreJson({ ok: false, error: result.error }, 400);
  return noStoreJson({
    ok: true,
    pincode: result.pincode,
    serviceable: result.serviceable,
    city: result.city,
    state: result.state,
    promised_date: result.promised_date,
    promised_label: result.promised_label,
    shipping_paise: result.zone.shipping_paise,
  });
}
