import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { revalidateTag } from "next/cache";
import { STORE_CACHE_TAG } from "@/lib/store/catalogue";
import { assertActiveSellingPrice, normalizeStoreProductPrices } from "@/lib/store/productPrice";
import { isAvailabilityMode } from "@/lib/store/availability";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Clean a JSON array of short bullet strings (What's included / Ideal for). */
function cleanStringArray(v: unknown): string[] | null {
  if (v == null) return null;
  const arr = Array.isArray(v) ? v : String(v).split("\n");
  const out = arr.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 20);
  return out;
}

const STAGES = new Set(["prelims", "mains", "both"]);

/** Apply the optional content fields shared by create + edit. */
function applyContentFields(patch: Record<string, unknown>, body: Record<string, unknown>): void {
  if (body.subtitle != null) patch.subtitle = String(body.subtitle).trim() || null;
  if (body.author != null) patch.author = String(body.author).trim() || null;
  if (body.subject != null) patch.subject = String(body.subject).trim() || null;
  if (body.language != null) patch.language = String(body.language).trim() || "english";
  if (body.edition != null) patch.edition = String(body.edition).trim() || null;
  if (body.short_description != null) patch.short_description = String(body.short_description).trim() || null;
  if (body.description_md != null) patch.description_md = String(body.description_md) || null;
  if (body.stage != null) patch.stage = STAGES.has(String(body.stage)) ? String(body.stage) : null;
  if (body.page_count != null && body.page_count !== "") patch.page_count = Math.max(0, Math.round(Number(body.page_count)));
  if (body.booklets != null && body.booklets !== "") patch.booklets = Math.max(0, Math.round(Number(body.booklets)));
  if (body.low_stock_threshold != null && body.low_stock_threshold !== "")
    patch.low_stock_threshold = Math.max(0, Math.round(Number(body.low_stock_threshold)));
  if (body.availability_mode != null) {
    if (!isAvailabilityMode(body.availability_mode)) throw new Error("invalid availability mode");
    patch.availability_mode = body.availability_mode;
  }
  if (body.highlights != null) patch.highlights_json = cleanStringArray(body.highlights);
  if (body.ideal_for != null) patch.ideal_for_json = cleanStringArray(body.ideal_for);
  if (body.category_id !== undefined) patch.category_id = body.category_id || null;
}

export async function GET() {
  if (!(await requirePermission("store_manage_catalogue"))) {
    return noStore({ ok: false, error: "Forbidden" }, 403);
  }
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);
  const { data } = await db
    .from("store_products")
    .select("id,sku,slug,name,subject,mrp_paise,selling_price_paise,on_hand,reserved,low_stock_threshold,availability_mode,is_active,kind")
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
    applyContentFields(insert, body);
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
    applyContentFields(patch, body);
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
