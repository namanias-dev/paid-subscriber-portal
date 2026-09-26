import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { revalidateTag } from "next/cache";
import { STORE_CACHE_TAG } from "@/lib/store/catalogue";
import { assertActiveSellingPrice, normalizeStoreProductPrices } from "@/lib/store/productPrice";
import { applyProductContentFields } from "@/lib/store/productAdmin";
import { deleteProductMedia, listProductMedia } from "@/lib/store/media/upload";
import { PREPARATION_STATUSES } from "@/lib/store/availability";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function toArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];
}

/** GET — the full editable product payload for the editor. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_catalogue"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);

  const { data: p } = await db.from("store_products").select("*").eq("id", params.id).maybeSingle();
  if (!p) return noStore({ ok: false, error: "not found" }, 404);

  const media = await listProductMedia(params.id);

  // Paid, not-yet-dispatched demand for this product (for on_demand display).
  let paidDemand = 0;
  const { data: openOrders } = await db.from("store_orders").select("id").in("status", [...PREPARATION_STATUSES]);
  const openIds = (openOrders || []).map((o) => o.id);
  if (openIds.length) {
    const { data: lines } = await db
      .from("store_order_items")
      .select("qty")
      .eq("product_id", params.id)
      .in("order_id", openIds);
    paidDemand = (lines || []).reduce((s, l) => s + Number(l.qty || 0), 0);
  }

  const { count: orderCount } = await db
    .from("store_order_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", params.id);

  return noStore({
    ok: true,
    product: {
      id: p.id,
      sku: p.sku,
      slug: p.slug,
      kind: p.kind,
      name: p.name,
      subtitle: p.subtitle,
      subject: p.subject,
      author: p.author,
      language: p.language,
      edition: p.edition,
      stage: p.stage,
      short_description: p.short_description,
      description_md: p.description_md,
      how_to_use_md: p.how_to_use_md,
      prelims_relevance_md: p.prelims_relevance_md,
      mains_relevance_md: p.mains_relevance_md,
      revision_value_md: p.revision_value_md,
      highlights: toArray(p.highlights_json),
      ideal_for: toArray(p.ideal_for_json),
      topics: toArray(p.topics_json),
      page_count: p.page_count,
      booklets: p.booklets,
      physical_format: p.physical_format,
      binding_type: p.binding_type,
      weight_grams: p.weight_grams,
      length_mm: p.length_mm,
      width_mm: p.width_mm,
      height_mm: p.height_mm,
      hsn_code: p.hsn_code,
      tax_treatment: p.tax_treatment,
      tax_rate_bps: p.tax_rate_bps,
      tax_configuration_status: p.tax_configuration_status,
      tax_configuration_source: p.tax_configuration_source,
      mrp_paise: p.mrp_paise,
      selling_price_paise: p.selling_price_paise,
      availability_mode: p.availability_mode,
      on_hand: p.on_hand,
      reserved: p.reserved,
      low_stock_threshold: p.low_stock_threshold,
      dispatch_days: p.dispatch_days,
      max_quantity_per_order: p.max_quantity_per_order,
      is_active: p.is_active,
      is_featured: p.is_featured,
      is_bestseller: p.is_bestseller,
      archived: !!p.archived_at,
      cover_image_key: p.cover_image_key,
      seo_title: p.seo_title,
      seo_description: p.seo_description,
      paid_demand: paidDemand,
      order_count: orderCount ?? 0,
    },
    media,
  });
}

/** PATCH — save edits and/or a lifecycle action (archive/unarchive). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_catalogue"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const { data: current } = await db
    .from("store_products")
    .select("id,mrp_paise,selling_price_paise,on_hand,reserved,is_active,availability_mode")
    .eq("id", params.id)
    .maybeSingle();
  if (!current) return noStore({ ok: false, error: "not found" }, 404);

  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.action === "archive") {
      patch.archived_at = new Date().toISOString();
      patch.is_active = false;
    } else if (body.action === "unarchive") {
      patch.archived_at = null;
    }

    if (body.name != null) patch.name = String(body.name).trim();
    applyProductContentFields(patch, body);

    if (body.selling_price_paise != null || body.mrp_paise != null) {
      const nextSelling = body.selling_price_paise != null ? body.selling_price_paise : current.selling_price_paise;
      const nextMrp = body.mrp_paise != null ? body.mrp_paise : current.mrp_paise;
      Object.assign(patch, normalizeStoreProductPrices({ mrp_paise: nextMrp, selling_price_paise: nextSelling }));
    }
    if (body.on_hand != null) {
      const onHand = Math.round(Number(body.on_hand));
      if (!Number.isFinite(onHand) || onHand < 0) throw new Error("Stock must be 0 or more");
      if (onHand < Number(current.reserved || 0)) throw new Error(`Stock cannot be below reserved (${current.reserved})`);
      patch.on_hand = onHand;
    }
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

    const selling = Number(patch.selling_price_paise ?? current.selling_price_paise);
    const active = typeof patch.is_active === "boolean" ? patch.is_active : current.is_active;
    // A live product needs a real price. (Cover/samples are encouraged, not required.)
    assertActiveSellingPrice(selling, !!active);

    const { error } = await db.from("store_products").update(patch).eq("id", params.id);
    if (error) return noStore({ ok: false, error: error.message }, 400);
    revalidateTag(STORE_CACHE_TAG);
    return noStore({ ok: true });
  } catch (e) {
    return noStore({ ok: false, error: (e as Error).message }, 400);
  }
}

/** DELETE — only when no order history references the product; else archive. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_catalogue"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);

  const { count } = await db
    .from("store_order_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", params.id);
  if ((count ?? 0) > 0) {
    return noStore(
      { ok: false, error: "This product has order history and cannot be deleted. Archive it instead.", code: "has_orders" },
      409,
    );
  }

  // Also a component of a bundle? Remove those links first.
  await db.from("store_bundle_items").delete().eq("component_id", params.id);
  await db.from("store_bundle_items").delete().eq("bundle_id", params.id);

  // Delete media (R2 + rows) then the product.
  const media = await listProductMedia(params.id);
  for (const m of media) await deleteProductMedia(m.id);
  const { error } = await db.from("store_products").delete().eq("id", params.id);
  if (error) return noStore({ ok: false, error: error.message }, 400);
  revalidateTag(STORE_CACHE_TAG);
  return noStore({ ok: true });
}
