/**
 * Store catalogue reads. ISR pages call these; nothing session-derived is
 * returned, so a cached product page cannot leak a cart count or a name.
 */
import { storeDb } from "./db";
import { publicCdnUrl } from "@/lib/r2";
import { unstable_cache } from "next/cache";
import {
  normalizeAvailabilityMode,
  resolveAvailability,
  type AvailabilityMode,
  type AvailabilityView,
} from "./availability";

export const STORE_CACHE_TAG = "notes-store";

export interface StoreCategory {
  id: string;
  slug: string;
  name: string;
  nav_label: string | null;
  short_description: string | null;
  cover_image_key: string | null;
  position: number;
}

export interface StoreProductCard {
  id: string;
  sku: string;
  slug: string;
  kind: "single" | "bundle";
  name: string;
  short_name: string | null;
  subject: string | null;
  stage: string | null;
  language: string;
  edition: string | null;
  page_count: number | null;
  mrp_paise: number;
  selling_price_paise: number;
  cover_image_key: string | null;
  cover_url: string | null;
  is_featured: boolean;
  is_bestseller: boolean;
  dispatch_days: number;
  sellable: number;
  category_slug: string | null;
  category_name: string | null;
  max_quantity_per_order: number;
  availability_mode: AvailabilityMode;
  availability: AvailabilityView;
}

export interface StoreProductMedia {
  id: string;
  kind: "photo" | "sample_page";
  r2_key: string;
  url: string | null;
  alt: string | null;
  source_page_no: number | null;
  position: number;
  width: number | null;
  height: number | null;
}

export interface StoreProductDetail extends StoreProductCard {
  description_md: string | null;
  short_description: string | null;
  subtitle: string | null;
  author: string | null;
  booklets: number | null;
  physical_format: string | null;
  highlights: string[];
  ideal_for: string[];
  topics: string[];
  how_to_use_md: string | null;
  prelims_relevance_md: string | null;
  mains_relevance_md: string | null;
  revision_value_md: string | null;
  weight_grams: number | null;
  binding_type: string | null;
  printing_type: string | null;
  hsn_code: string | null;
  tax_treatment: string;
  tax_rate_bps: number;
  seo_title: string | null;
  seo_description: string | null;
  photos: StoreProductMedia[];
  samples: StoreProductMedia[];
  /** For kind === "bundle": the included component products, in order. */
  bundle_items: StoreBundleItem[];
  /** Sum of component selling prices (for a bundle) — the "individual total". */
  components_total_paise: number;
}

export interface StoreBundleItem {
  product_id: string;
  slug: string;
  name: string;
  subject: string | null;
  qty: number;
  selling_price_paise: number;
  cover_url: string | null;
  availability: AvailabilityView;
}

function coverUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.startsWith("store-private/")) return null;
  return publicCdnUrl(key);
}

function toCard(row: Record<string, unknown>, category?: { slug: string; name: string } | null): StoreProductCard {
  const onHand = Number(row.on_hand || 0);
  const reserved = Number(row.reserved || 0);
  const sellable = Math.max(0, onHand - reserved);
  const availabilityMode = normalizeAvailabilityMode(row.availability_mode);
  const isActive = !!row.is_active;
  const lowStockThreshold = Number(row.low_stock_threshold ?? 5);
  return {
    id: String(row.id),
    sku: String(row.sku),
    slug: String(row.slug),
    kind: row.kind === "bundle" ? "bundle" : "single",
    name: String(row.name),
    short_name: (row.short_name as string) || null,
    subject: (row.subject as string) || null,
    stage: (row.stage as string) || null,
    language: String(row.language || "english"),
    edition: (row.edition as string) || null,
    page_count: row.page_count == null ? null : Number(row.page_count),
    mrp_paise: Number(row.mrp_paise || 0),
    selling_price_paise: Number(row.selling_price_paise || 0),
    cover_image_key: (row.cover_image_key as string) || null,
    cover_url: coverUrl((row.cover_image_key as string) || null),
    is_featured: !!row.is_featured,
    is_bestseller: !!row.is_bestseller,
    dispatch_days: Number(row.dispatch_days || 2),
    sellable,
    category_slug: category?.slug ?? null,
    category_name: category?.name ?? null,
    max_quantity_per_order: Number(row.max_quantity_per_order || 5),
    availability_mode: availabilityMode,
    availability: resolveAvailability(availabilityMode, sellable, lowStockThreshold, isActive),
  };
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

async function listActiveCategoriesUncached(): Promise<StoreCategory[]> {
  const db = storeDb();
  if (!db) return [];
  const { data } = await db
    .from("store_categories")
    .select("id,slug,name,nav_label,short_description,cover_image_key,position")
    .eq("is_active", true)
    .order("position", { ascending: true });
  return (data || []) as StoreCategory[];
}

export const listActiveCategories = unstable_cache(listActiveCategoriesUncached, ["store-categories"], {
  tags: [STORE_CACHE_TAG],
  revalidate: 600,
});

export async function getCategoryBySlug(slug: string): Promise<StoreCategory | null> {
  const db = storeDb();
  if (!db) return null;
  const { data } = await db
    .from("store_categories")
    .select("id,slug,name,nav_label,short_description,cover_image_key,position")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  return (data as StoreCategory) || null;
}

const PRODUCT_LIST_COLS =
  "id,sku,slug,kind,name,short_name,subject,stage,language,edition,page_count,mrp_paise,selling_price_paise,cover_image_key,is_featured,is_bestseller,dispatch_days,on_hand,reserved,low_stock_threshold,availability_mode,is_active,max_quantity_per_order,category_id,position";

export async function listActiveProducts(opts?: {
  categoryId?: string;
  bestsellers?: boolean;
  featured?: boolean;
  kind?: "single" | "bundle";
  limit?: number;
}): Promise<StoreProductCard[]> {
  const db = storeDb();
  if (!db) return [];
  let q = db.from("store_products").select(PRODUCT_LIST_COLS).eq("is_active", true);
  if (opts?.categoryId) q = q.eq("category_id", opts.categoryId);
  if (opts?.bestsellers) q = q.eq("is_bestseller", true);
  if (opts?.featured) q = q.eq("is_featured", true);
  if (opts?.kind) q = q.eq("kind", opts.kind);
  q = q.order("position", { ascending: true }).order("name", { ascending: true });
  if (opts?.limit) q = q.limit(opts.limit);
  const { data } = await q;
  const rows = data || [];
  const catIds = [...new Set(rows.map((r) => r.category_id).filter(Boolean))] as string[];
  const cats = new Map<string, { slug: string; name: string }>();
  if (catIds.length) {
    const { data: cdata } = await db.from("store_categories").select("id,slug,name").in("id", catIds);
    for (const c of cdata || []) cats.set(c.id, { slug: c.slug, name: c.name });
  }
  return rows.map((r) => toCard(r as Record<string, unknown>, r.category_id ? cats.get(r.category_id) || null : null));
}

export async function getProductBySlug(slug: string): Promise<StoreProductDetail | null> {
  const db = storeDb();
  if (!db) return null;
  const { data } = await db
    .from("store_products")
    .select("*, store_categories(slug,name)")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  const cat = (data as { store_categories?: { slug: string; name: string } | null }).store_categories || null;
  const card = toCard(data as Record<string, unknown>, cat);
  const { data: media } = await db
    .from("store_product_media")
    .select("id,kind,r2_key,alt,source_page_no,position,width,height")
    .eq("product_id", data.id)
    .order("position", { ascending: true });

  const photos: StoreProductMedia[] = [];
  const samples: StoreProductMedia[] = [];
  for (const m of media || []) {
    const item: StoreProductMedia = {
      id: m.id,
      kind: m.kind,
      r2_key: m.r2_key,
      url: m.kind === "photo" ? coverUrl(m.r2_key) : `/api/notes/sample/${m.id}`,
      alt: m.alt,
      source_page_no: m.source_page_no,
      position: m.position,
      width: m.width,
      height: m.height,
    };
    if (m.kind === "sample_page") samples.push(item);
    else photos.push(item);
  }

  // Bundle components (only for kind === "bundle").
  const bundleItems: StoreBundleItem[] = [];
  let componentsTotal = 0;
  if (data.kind === "bundle") {
    const { data: comps } = await db
      .from("store_bundle_items")
      .select("component_id,qty,position")
      .eq("bundle_id", data.id)
      .order("position", { ascending: true });
    const compIds = (comps || []).map((c) => c.component_id);
    if (compIds.length) {
      const { data: compProducts } = await db.from("store_products").select(PRODUCT_LIST_COLS).in("id", compIds);
      const byId = new Map((compProducts || []).map((cp) => [cp.id, toCard(cp as Record<string, unknown>)]));
      for (const c of comps || []) {
        const cp = byId.get(c.component_id);
        if (!cp) continue;
        const qty = Number(c.qty || 1);
        componentsTotal += cp.selling_price_paise * qty;
        bundleItems.push({
          product_id: cp.id,
          slug: cp.slug,
          name: cp.name,
          subject: cp.subject,
          qty,
          selling_price_paise: cp.selling_price_paise,
          cover_url: cp.cover_url,
          availability: cp.availability,
        });
      }
    }
  }

  return {
    ...card,
    description_md: data.description_md,
    short_description: data.short_description,
    subtitle: data.subtitle ?? null,
    author: data.author ?? null,
    booklets: data.booklets == null ? null : Number(data.booklets),
    physical_format: data.physical_format ?? null,
    highlights: toStringArray(data.highlights_json),
    ideal_for: toStringArray(data.ideal_for_json),
    topics: toStringArray(data.topics_json),
    how_to_use_md: data.how_to_use_md ?? null,
    prelims_relevance_md: data.prelims_relevance_md ?? null,
    mains_relevance_md: data.mains_relevance_md ?? null,
    revision_value_md: data.revision_value_md ?? null,
    weight_grams: data.weight_grams,
    binding_type: data.binding_type,
    printing_type: data.printing_type,
    hsn_code: data.hsn_code,
    tax_treatment: data.tax_treatment,
    tax_rate_bps: data.tax_rate_bps,
    seo_title: data.seo_title,
    seo_description: data.seo_description,
    photos,
    samples,
    bundle_items: bundleItems,
    components_total_paise: componentsTotal,
  };
}

export async function getProductById(id: string): Promise<StoreProductCard | null> {
  const db = storeDb();
  if (!db) return null;
  const { data } = await db
    .from("store_products")
    .select(PRODUCT_LIST_COLS)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  return toCard(data as Record<string, unknown>);
}
