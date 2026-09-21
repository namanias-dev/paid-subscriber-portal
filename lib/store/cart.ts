/**
 * Server-side cart. The browser holds only an opaque id in an httpOnly cookie.
 * Prices live in the database, so a cached product page can never embed them.
 */
import { cookies } from "next/headers";
import { storeDb } from "./db";
import { lineTaxPaise } from "./money";
import { maxPurchasableQty } from "./availability";
import type { StoreProductCard } from "./catalogue";
import { calculateCartPricing, type StoreOfferDiscountType } from "./pricing";
import { getActiveStoreOffer, toPricingOffer } from "./offers";

export const CART_COOKIE = "nias_notes_cart";
const CART_TTL_DAYS = 30;

export interface CartItemView {
  id: string;
  product_id: string;
  qty: number;
  product: StoreProductCard;
  line_total_paise: number;
  line_discount_paise: number;
  regular_line_paise: number;
}

export interface CartView {
  id: string;
  items: CartItemView[];
  item_count: number;
  subtotal_paise: number;
  discount_paise: number;
  tax_paise: number;
  max_dispatch_days: number;
  offer_id: string | null;
  offer_name: string | null;
  offer_slug: string | null;
  discount_type: StoreOfferDiscountType | null;
  discount_value: number | null;
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: CART_TTL_DAYS * 24 * 60 * 60,
  };
}

export function readCartId(): string | null {
  return cookies().get(CART_COOKIE)?.value || null;
}

export function writeCartId(id: string): void {
  cookies().set(CART_COOKIE, id, cookieOpts());
}

async function loadProduct(id: string): Promise<StoreProductCard | null> {
  const { getProductById } = await import("./catalogue");
  return getProductById(id);
}

export async function getOrCreateCart(): Promise<string> {
  const existing = readCartId();
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  if (existing) {
    const { data } = await db.from("store_carts").select("id,status").eq("id", existing).maybeSingle();
    if (data && data.status === "open") return data.id;
  }
  const { data, error } = await db.from("store_carts").insert({ status: "open" }).select("id").single();
  if (error || !data) throw new Error(error?.message || "could not create cart");
  writeCartId(data.id);
  return data.id;
}

export async function getCartView(cartId?: string | null): Promise<CartView | null> {
  const id = cartId || readCartId();
  const db = storeDb();
  if (!id || !db) return null;
  const { data: cart } = await db.from("store_carts").select("id,status").eq("id", id).maybeSingle();
  if (!cart || cart.status !== "open") return null;
  const { data: items } = await db
    .from("store_cart_items")
    .select("id,product_id,qty")
    .eq("cart_id", id)
    .order("created_at", { ascending: true });
  const raw: Array<{ id: string; product_id: string; qty: number; product: StoreProductCard }> = [];
  for (const it of items || []) {
    const product = await loadProduct(it.product_id);
    if (!product) continue;
    raw.push({ id: it.id, product_id: it.product_id, qty: it.qty, product });
  }
  const activeOfferRow = await getActiveStoreOffer();
  const offer = activeOfferRow ? toPricingOffer(activeOfferRow) : null;
  const priced = calculateCartPricing(
    raw.map((r) => ({
      product: {
        id: r.product.id,
        kind: r.product.kind,
        category_id: r.product.category_id,
        selling_price_paise: r.product.selling_price_paise,
      },
      qty: r.qty,
    })),
    offer,
  );
  const byProduct = new Map(priced.lines.map((l) => [l.product_id, l]));
  const views: CartItemView[] = raw.map((r) => {
    const line = byProduct.get(r.product_id);
    return {
      id: r.id,
      product_id: r.product_id,
      qty: r.qty,
      product: r.product,
      regular_line_paise: line?.base_paise ?? r.product.selling_price_paise * r.qty,
      line_discount_paise: line?.discount_paise ?? 0,
      line_total_paise: line?.final_paise ?? r.product.selling_price_paise * r.qty,
    };
  });
  const tax = views.reduce((s, v) => s + lineTaxPaise(v.line_total_paise, "exempt", 0), 0);
  return {
    id,
    items: views,
    item_count: views.reduce((s, v) => s + v.qty, 0),
    subtotal_paise: priced.subtotal_paise,
    discount_paise: priced.discount_paise,
    tax_paise: tax,
    max_dispatch_days: views.reduce((m, v) => Math.max(m, v.product.dispatch_days), 0) || 2,
    offer_id: priced.offer_id,
    offer_name: priced.offer_name,
    offer_slug: priced.offer_slug,
    discount_type: priced.discount_type,
    discount_value: priced.discount_value,
  };
}

export async function addToCart(productId: string, qty: number): Promise<CartView> {
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  const product = await loadProduct(productId);
  if (!product) throw new Error("That product is no longer available");
  if (!product.availability.purchasable) {
    throw new Error(
      product.availability.state === "coming_soon"
        ? "This title is coming soon"
        : product.availability.state === "out_of_stock"
          ? "This title is currently out of stock"
          : "This title is currently unavailable",
    );
  }
  const cap = maxPurchasableQty(product.availability_mode, product.sellable, product.max_quantity_per_order);
  const want = Math.max(1, Math.min(qty, cap));
  const cartId = await getOrCreateCart();
  const { data: existing } = await db
    .from("store_cart_items")
    .select("id,qty")
    .eq("cart_id", cartId)
    .eq("product_id", productId)
    .maybeSingle();
  if (existing) {
    const next = Math.min(existing.qty + want, cap);
    await db.from("store_cart_items").update({ qty: next, updated_at: new Date().toISOString() }).eq("id", existing.id);
  } else {
    await db.from("store_cart_items").insert({
      cart_id: cartId,
      product_id: productId,
      qty: Math.min(want, cap),
    });
  }
  const view = await getCartView(cartId);
  if (!view) throw new Error("cart vanished");
  return view;
}

export async function setCartQty(itemId: string, qty: number): Promise<CartView | null> {
  const db = storeDb();
  const cartId = readCartId();
  if (!db || !cartId) return null;
  if (qty <= 0) {
    await db.from("store_cart_items").delete().eq("id", itemId).eq("cart_id", cartId);
  } else {
    const { data: row } = await db
      .from("store_cart_items")
      .select("product_id")
      .eq("id", itemId)
      .eq("cart_id", cartId)
      .maybeSingle();
    if (!row) return getCartView(cartId);
    const product = await loadProduct(row.product_id);
    if (!product || !product.availability.purchasable) {
      await db.from("store_cart_items").delete().eq("id", itemId).eq("cart_id", cartId);
      return getCartView(cartId);
    }
    const cap = maxPurchasableQty(product.availability_mode, product.sellable, product.max_quantity_per_order);
    const next = Math.min(Math.max(1, Math.round(qty)), cap);
    await db.from("store_cart_items").update({ qty: next, updated_at: new Date().toISOString() }).eq("id", itemId);
  }
  return getCartView(cartId);
}

export async function removeCartItem(itemId: string): Promise<CartView | null> {
  return setCartQty(itemId, 0);
}
