/**
 * Read-only bundle save suggestion. Never mutates the cart, quote, or inventory.
 * The customer keeps control — this only surfaces a financially correct option.
 */
import { formatPaise } from "./money";

export interface BundleOfferCartItem {
  product_id: string;
  qty: number;
  unit_paise: number;
  kind?: "single" | "bundle";
}

export interface BundleOfferCandidate {
  id: string;
  slug: string;
  name: string;
  selling_price_paise: number;
  components: Array<{ product_id: string; qty: number; selling_price_paise: number }>;
}

export interface BundleOffer {
  bundle_id: string;
  slug: string;
  name: string;
  save_paise: number;
  save_label: string;
}

export function computeBundleOffer(
  cartItems: BundleOfferCartItem[],
  bundles: BundleOfferCandidate[],
): BundleOffer | null {
  if (!cartItems.length || !bundles.length) return null;
  const cartBundles = new Set(cartItems.filter((i) => i.kind === "bundle").map((i) => i.product_id));
  const qtyById = new Map<string, { qty: number; unit_paise: number }>();
  for (const item of cartItems) {
    if (item.kind === "bundle") continue;
    const cur = qtyById.get(item.product_id);
    if (cur) cur.qty += item.qty;
    else qtyById.set(item.product_id, { qty: item.qty, unit_paise: item.unit_paise });
  }

  let best: BundleOffer | null = null;
  for (const bundle of bundles) {
    if (cartBundles.has(bundle.id)) continue;
    if (!bundle.components.length) continue;
    let covered = 0;
    let allPresent = true;
    for (const component of bundle.components) {
      const inCart = qtyById.get(component.product_id);
      if (!inCart || inCart.qty < component.qty) {
        allPresent = false;
        break;
      }
      covered += (inCart.unit_paise || component.selling_price_paise) * component.qty;
    }
    if (!allPresent) continue;
    const save = covered - bundle.selling_price_paise;
    if (save <= 0) continue;
    if (!best || save > best.save_paise) {
      best = {
        bundle_id: bundle.id,
        slug: bundle.slug,
        name: bundle.name,
        save_paise: save,
        save_label: formatPaise(save),
      };
    }
  }
  return best;
}
