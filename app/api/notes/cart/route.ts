import { addToCart, getCartView, getOrCreateCart, removeCartItem, setCartQty } from "@/lib/store/cart";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";
import { formatPaise } from "@/lib/store/money";
import { computeBundleOffer } from "@/lib/store/bundleOffer";
import { getProductBySlug, listActiveProducts } from "@/lib/store/catalogue";

export const dynamic = "force-dynamic";

async function serialize(view: Awaited<ReturnType<typeof getCartView>>) {
  if (!view) return { ok: true, cart: { id: null, items: [], item_count: 0, subtotal_paise: 0, subtotal_label: formatPaise(0) } };
  const items = view.items.map((it) => ({
    id: it.id,
    product_id: it.product_id,
    qty: it.qty,
    name: it.product.name,
    slug: it.product.slug,
    subject: it.product.subject || it.product.category_name,
    cover_url: it.product.cover_url,
    unit_paise: it.product.selling_price_paise,
    unit_label: formatPaise(it.product.selling_price_paise),
    line_total_paise: it.line_total_paise,
    line_label: formatPaise(it.line_total_paise),
    sellable: it.product.sellable,
    max_qty: it.product.max_quantity_per_order,
    availability: it.product.availability.label,
    kind: it.product.kind,
  }));
  let bundle_offer = null;
  try {
    const bundles = await listActiveProducts({ kind: "bundle", limit: 8 });
    const details = await Promise.all(bundles.map((b) => getProductBySlug(b.slug)));
    bundle_offer = computeBundleOffer(
      items.map((it) => ({ product_id: it.product_id, qty: it.qty, unit_paise: it.unit_paise, kind: it.kind })),
      details.filter(Boolean).map((d) => ({
        id: d!.id,
        slug: d!.slug,
        name: d!.name,
        selling_price_paise: d!.selling_price_paise,
        components: d!.bundle_items.map((c) => ({
          product_id: c.product_id,
          qty: c.qty,
          selling_price_paise: c.selling_price_paise,
        })),
      })),
    );
  } catch {
    bundle_offer = null;
  }
  return {
    ok: true,
    cart: {
      id: view.id,
      item_count: view.item_count,
      subtotal_paise: view.subtotal_paise,
      subtotal_label: formatPaise(view.subtotal_paise),
      max_dispatch_days: view.max_dispatch_days,
      items,
      bundle_offer,
    },
  };
}

export async function GET() {
  const dark = await requireLiveStore();
  if (dark) return dark;
  try {
    return noStoreJson(await serialize(await getCartView()));
  } catch (e) {
    return noStoreJson({ ok: false, error: (e as Error).message }, 500);
  }
}

export async function POST(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  try {
    const body = (await req.json()) as { product_id?: string; qty?: number };
    if (!body.product_id) return noStoreJson({ ok: false, error: "product_id required" }, 400);
    await getOrCreateCart();
    const view = await addToCart(body.product_id, Number(body.qty || 1));
    return noStoreJson(await serialize(view));
  } catch (e) {
    return noStoreJson({ ok: false, error: (e as Error).message }, 400);
  }
}

export async function PATCH(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  try {
    const body = (await req.json()) as { item_id?: string; qty?: number };
    if (!body.item_id) return noStoreJson({ ok: false, error: "item_id required" }, 400);
    return noStoreJson(await serialize(await setCartQty(body.item_id, Number(body.qty))));
  } catch (e) {
    return noStoreJson({ ok: false, error: (e as Error).message }, 400);
  }
}

export async function DELETE(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  try {
    const url = new URL(req.url);
    const itemId = url.searchParams.get("item_id");
    if (!itemId) return noStoreJson({ ok: false, error: "item_id required" }, 400);
    return noStoreJson(await serialize(await removeCartItem(itemId)));
  } catch (e) {
    return noStoreJson({ ok: false, error: (e as Error).message }, 400);
  }
}
