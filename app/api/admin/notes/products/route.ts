import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { revalidateTag } from "next/cache";
import { STORE_CACHE_TAG } from "@/lib/store/catalogue";
import { assertActiveSellingPrice, normalizeStoreProductPrices } from "@/lib/store/productPrice";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  if (!(await requirePermission("store_manage_catalogue"))) {
    return noStore({ ok: false, error: "Forbidden" }, 403);
  }
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);
  const { data } = await db
    .from("store_products")
    .select("id,sku,slug,name,mrp_paise,selling_price_paise,on_hand,reserved,is_active,kind")
    .order("position", { ascending: true });
  return noStore({ ok: true, products: data || [] });
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
    const { data, error } = await db
      .from("store_products")
      .insert({
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
      })
      .select("id")
      .single();
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
