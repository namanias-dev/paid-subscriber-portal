/**
 * Shared admin product field handling — used by the create/list route and the
 * per-product editor route so both apply the same validation and mapping.
 *
 * Admin never sends raw JSON column names: the UI works in natural fields
 * (highlights, ideal_for, topics, price in rupees, etc.) and this maps them to
 * storage. Nothing here touches money/identity tables — catalogue only.
 */
import { isAvailabilityMode } from "./availability";
import { validateProductPackage } from "./packageProfile";

export const STAGES = new Set(["prelims", "mains", "both"]);

/** Clean a list of short bullet strings (What's included / Ideal for / Topics). */
export function cleanStringArray(v: unknown): string[] | null {
  if (v == null) return null;
  const arr = Array.isArray(v) ? v : String(v).split("\n");
  return arr.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 40);
}

function intOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Apply the optional content/detail fields shared by create + edit onto a patch
 * object. Throws only on a genuinely invalid enum. Prices, stock, is_active and
 * lifecycle are handled by the caller.
 */
export function applyProductContentFields(patch: Record<string, unknown>, body: Record<string, unknown>): void {
  const str = (k: string, col = k) => {
    if (body[k] != null) patch[col] = String(body[k]).trim() || null;
  };
  str("subtitle");
  str("author");
  str("subject");
  str("edition");
  str("short_description");
  str("physical_format");
  str("binding_type");
  str("printing_type");
  str("seo_title");
  str("seo_description");
  str("video_url");
  if (body.language != null) patch.language = String(body.language).trim() || "english";
  if (body.description_md != null) patch.description_md = String(body.description_md) || null;
  if (body.how_to_use_md != null) patch.how_to_use_md = String(body.how_to_use_md) || null;
  if (body.prelims_relevance_md != null) patch.prelims_relevance_md = String(body.prelims_relevance_md) || null;
  if (body.mains_relevance_md != null) patch.mains_relevance_md = String(body.mains_relevance_md) || null;
  if (body.revision_value_md != null) patch.revision_value_md = String(body.revision_value_md) || null;
  if (body.stage != null) patch.stage = STAGES.has(String(body.stage)) ? String(body.stage) : null;

  if (body.page_count !== undefined) patch.page_count = intOrNull(body.page_count);
  if (body.booklets !== undefined) patch.booklets = intOrNull(body.booklets);
  if (body.weight_grams !== undefined) patch.weight_grams = intOrNull(body.weight_grams);
  if (body.length_mm !== undefined) patch.length_mm = intOrNull(body.length_mm);
  if (body.width_mm !== undefined) patch.width_mm = intOrNull(body.width_mm);
  if (body.height_mm !== undefined) patch.height_mm = intOrNull(body.height_mm);
  if (body.weight_grams !== undefined || body.length_mm !== undefined || body.width_mm !== undefined || body.height_mm !== undefined) {
    const invalid = validateProductPackage({
      weightGrams: (patch.weight_grams as number | null) ?? null,
      lengthMm: (patch.length_mm as number | null) ?? null,
      widthMm: (patch.width_mm as number | null) ?? null,
      heightMm: (patch.height_mm as number | null) ?? null,
    });
    if (invalid) throw new Error(invalid);
  }
  if (body.dispatch_days != null && body.dispatch_days !== "") patch.dispatch_days = Math.max(0, Math.round(Number(body.dispatch_days)));
  if (body.max_quantity_per_order != null && body.max_quantity_per_order !== "")
    patch.max_quantity_per_order = Math.max(1, Math.round(Number(body.max_quantity_per_order)));
  if (body.low_stock_threshold != null && body.low_stock_threshold !== "")
    patch.low_stock_threshold = Math.max(0, Math.round(Number(body.low_stock_threshold)));

  if (body.availability_mode != null) {
    if (!isAvailabilityMode(body.availability_mode)) throw new Error("invalid availability mode");
    patch.availability_mode = body.availability_mode;
  }
  if (typeof body.is_featured === "boolean") patch.is_featured = body.is_featured;
  if (typeof body.is_bestseller === "boolean") patch.is_bestseller = body.is_bestseller;

  if (body.highlights !== undefined) patch.highlights_json = cleanStringArray(body.highlights);
  if (body.ideal_for !== undefined) patch.ideal_for_json = cleanStringArray(body.ideal_for);
  if (body.topics !== undefined) patch.topics_json = cleanStringArray(body.topics);
  if (body.category_id !== undefined) patch.category_id = body.category_id || null;

  if (body.hsn_code !== undefined) {
    const hsn = String(body.hsn_code || "").replace(/\s/g, "");
    if (hsn && !/^\d{4,8}$/.test(hsn)) throw new Error("HSN must be 4 to 8 digits.");
    patch.hsn_code = hsn || null;
  }
  if (body.tax_treatment !== undefined) {
    const treatment = String(body.tax_treatment);
    if (treatment !== "exempt" && treatment !== "nil" && treatment !== "taxable") throw new Error("Invalid tax treatment.");
    patch.tax_treatment = treatment;
  }
  if (body.tax_rate_bps !== undefined) {
    const bps = Math.round(Number(body.tax_rate_bps));
    if (!Number.isFinite(bps) || bps < 0 || bps > 4000) throw new Error("GST rate is out of range.");
    patch.tax_rate_bps = bps;
  }
}
