import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { revalidateTag } from "next/cache";
import { STORE_CACHE_TAG } from "@/lib/store/catalogue";
import { assertActiveSellingPrice, normalizeStoreProductPrices } from "@/lib/store/productPrice";
import { applyProductContentFields } from "@/lib/store/productAdmin";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  if (!(await requirePermission("store_manage_catalogue"))) {
    return noStore({ ok: false, error: "Forbidden" }, 403);
  }
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);
  const includeArchived = new URL(req.url).searchParams.get("include_archived") === "1";

  let q = db
    .from("store_products")
    .select(
      "id,sku,slug,name,subject,mrp_paise,selling_price_paise,on_hand,reserved,low_stock_threshold,availability_mode,is_active,kind,cover_image_key,archived_at",
    )
    .order("position", { ascending: true });
  if (!includeArchived) q = q.is("archived_at", null);
  const { data } = await q;
  const products = data || [];
  const ids = products.map((p) => p.id);

  // Sample-page counts and order counts for the catalogue cards.
  const sampleCount = new Map<string, number>();
  const orderCount = new Map<string, number>();
  if (ids.length) {
    const { data: media } = await db
      .from("store_product_media")
      .select("product_id")
      .in("product_id", ids)
      .eq("kind", "sample_page");
    for (const m of media || []) sampleCount.set(m.product_id, (sampleCount.get(m.product_id) || 0) + 1);
    const { data: items } = await db.from("store_order_items").select("product_id").in("product_id", ids);
    for (const it of items || []) orderCount.set(it.product_id, (orderCount.get(it.product_id) || 0) + 1);
  }

  return noStore({
    ok: true,
    products: products.map((p) => ({
      ...p,
      sellable: Math.max(0, Number(p.on_hand || 0) - Number(p.reserved || 0)),
      has_cover: !!p.cover_image_key,
      sample_count: sampleCount.get(p.id) || 0,
      order_count: orderCount.get(p.id) || 0,
      archived: !!p.archived_at,
    })),
  });
}

export async function POST(req: Request) {
  if (!(await requirePermission("store_manage_catalogue"))) {
    return noStore({ ok: false, error: "Forbidden" }, 403);
  }
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);
  const body = await req.json();
  try {
    const prices = normalizeStoreProductPrices(body);
    const isActive = !!body.is_active;
    assertActiveSellingPrice(prices.selling_price_paise, isActive);
    const insert: Record<string, unknown> = {
      sku: String(body.sku || "").trim(),
      slug: String(body.slug || "").trim(),
      name: String(body.name || "").trim(),
      category_id: body.category_id || null,
      kind: body.kind || "single",
      mrp_paise: prices.mrp_paise,
      selling_price_paise: prices.selling_price_paise,
      on_hand: Math.max(0, Math.round(Number(body.on_hand || 0))),
      dispatch_days: Number(body.dispatch_days || 2),
      short_description: body.short_description || null,
      is_active: isActive,
    };
    applyProductContentFields(insert, body);
    const { data, error } = await db.from("store_products").insert(insert).select("id").single();
    if (error) return noStore({ ok: false, error: error.message }, 400);
    revalidateTag(STORE_CACHE_TAG);
    return noStore({ ok: true, id: data.id });
  } catch (e) {
    return noStore({ ok: false, error: (e as Error).message }, 400);
  }
}

export async function PATCH(req: Request) {
  if (!(await requirePermission("store_manage_catalogue"))) {
    return noStore({ ok: false, error: "Forbidden" }, 403);
  }
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);
  const body = await req.json();
  const id = String(body.id || "").trim();
  if (!id) return noStore({ ok: false, error: "id required" }, 400);

  const { data: current, error: loadErr } = await db
    .from("store_products")
    .select("id,mrp_paise,selling_price_paise,on_hand,reserved,is_active")
    .eq("id", id)
    .maybeSingle();
  if (loadErr || !current) return noStore({ ok: false, error: loadErr?.message || "not found" }, 404);

  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name != null) patch.name = String(body.name).trim();
    const nextSelling = body.selling_price_paise != null ? body.selling_price_paise : current.selling_price_paise;
    const nextMrp = body.mrp_paise != null ? body.mrp_paise : current.mrp_paise;
    if (body.selling_price_paise != null || body.mrp_paise != null) {
      Object.assign(patch, normalizeStoreProductPrices({ mrp_paise: nextMrp, selling_price_paise: nextSelling }));
    }
    if (body.on_hand != null) {
      const onHand = Math.round(Number(body.on_hand));
      if (!Number.isFinite(onHand) || onHand < 0) throw new Error("on_hand must be 0 or more");
      if (onHand < Number(current.reserved || 0)) {
        throw new Error(`on_hand cannot be below reserved (${current.reserved})`);
      }
      patch.on_hand = onHand;
    }
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    applyProductContentFields(patch, body);
    const selling = Number(patch.selling_price_paise ?? current.selling_price_paise);
    const active = typeof patch.is_active === "boolean" ? patch.is_active : current.is_active;
    assertActiveSellingPrice(selling, !!active);

    const { error } = await db.from("store_products").update(patch).eq("id", id);
    if (error) return noStore({ ok: false, error: error.message }, 400);
    revalidateTag(STORE_CACHE_TAG);
    return noStore({ ok: true, id });
  } catch (e) {
    return noStore({ ok: false, error: (e as Error).message }, 400);
  }
}
