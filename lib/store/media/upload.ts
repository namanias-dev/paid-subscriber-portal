/**
 * Notes Store admin media pipeline — the write side of product imagery.
 *
 * Two kinds of media, two very different treatments (spec §6, §28):
 *
 *  - `sample_page`: the untouched upload is stored under a PRIVATE R2 prefix and
 *    never gets a URL; a watermarked, downscaled, EXIF-stripped WebP derivative
 *    (via `renderSamplePageDerivative`) is what the store's own route serves.
 *    This is the "preview the notes without giving them away" guarantee.
 *  - `photo`: marketing imagery — downscaled + re-encoded (`renderProductPhoto`,
 *    no watermark) and stored under the public `media/` prefix so the CDN serves
 *    it directly, same as every other Academy public image.
 *
 * All bytes flow server→R2; credentials never touch the client. Reuses the
 * existing `lib/r2` client (Cloudflare R2, S3-compatible) rather than inventing a
 * second storage path, and Supabase storage is deliberately NOT used for store
 * media.
 */
import { randomUUID } from "node:crypto";
import { storeDb } from "../db";
import { deleteObject, getObject, putObject } from "@/lib/r2";
import {
  renderProductPhoto,
  renderSamplePageDerivative,
  samplePageDerivativeKey,
  samplePageOriginalKey,
} from "./watermark";
import { getPdfPageCount, normalizePageSelection, rasterizePdfPage } from "./pdf";

export const MAX_MEDIA_BYTES = 12 * 1024 * 1024; // 12 MB — page scans can be large
export const MAX_PDF_BYTES = 40 * 1024 * 1024; // 40 MB — full note PDFs
export const ALLOWED_MEDIA_EXT = new Set(["jpg", "jpeg", "png", "webp"]);

/** Private R2 key for an uploaded sample PDF original (never served). */
export function samplePdfOriginalKey(productId: string, fileId: string): string {
  return `store-private/sample-pdf/${productId}/${fileId}.pdf`;
}

/** True only for keys under this product's private sample-PDF prefix. */
export function isOwnedSamplePdfKey(productId: string, key: string): boolean {
  return typeof key === "string" && key.startsWith(`store-private/sample-pdf/${productId}/`) && key.endsWith(".pdf");
}

/** Public R2 key for a product photo (served via the CDN like other media). */
export function productPhotoKey(productId: string, fileId: string): string {
  return `media/store/products/${productId}/${fileId}.webp`;
}

export interface StoreMediaRow {
  id: string;
  product_id: string;
  kind: "photo" | "sample_page";
  r2_key: string;
  original_key: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  alt: string | null;
  source_page_no: number | null;
  is_public: boolean;
  position: number;
}

export function normalizeExt(nameOrExt: string): string {
  const ext = (nameOrExt.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext === "jpeg" ? "jpg" : ext;
}

async function nextPosition(productId: string, kind: "photo" | "sample_page"): Promise<number> {
  const db = storeDb();
  if (!db) return 0;
  const { data } = await db
    .from("store_product_media")
    .select("position")
    .eq("product_id", productId)
    .eq("kind", kind)
    .order("position", { ascending: false })
    .limit(1);
  return (data?.[0]?.position ?? -1) + 1;
}

/**
 * Upload one sample page: private original + watermarked public-route derivative.
 * The customer can only ever reach the derivative, through `/api/notes/sample/[id]`.
 */
export async function uploadSamplePage(
  productId: string,
  input: Buffer,
  ext: string,
  opts?: { sourcePageNo?: number | null; alt?: string | null; contentType?: string },
): Promise<StoreMediaRow> {
  const db = storeDb();
  if (!db) throw new Error("store unavailable");

  const fileId = randomUUID();
  const originalKey = samplePageOriginalKey(productId, fileId, ext);
  const derivativeKey = samplePageDerivativeKey(productId, fileId);

  // Render first: an unreadable image throws before anything is stored.
  const derivative = await renderSamplePageDerivative(input);

  await putObject(originalKey, input, opts?.contentType);
  await putObject(derivativeKey, derivative.buffer, "image/webp");

  const { data, error } = await db
    .from("store_product_media")
    .insert({
      product_id: productId,
      kind: "sample_page",
      r2_key: derivativeKey,
      original_key: originalKey,
      width: derivative.width,
      height: derivative.height,
      bytes: derivative.bytes,
      alt: opts?.alt ?? null,
      source_page_no: opts?.sourcePageNo ?? null,
      is_public: false,
      position: await nextPosition(productId, "sample_page"),
    })
    .select("*")
    .single();
  if (error) {
    // Best-effort cleanup so a failed insert does not orphan R2 objects.
    await deleteObject(derivativeKey);
    await deleteObject(originalKey);
    throw new Error(error.message);
  }
  return data as StoreMediaRow;
}

/** Upload one product photo (no watermark) to the public media prefix. */
export async function uploadProductPhoto(
  productId: string,
  input: Buffer,
  opts?: { alt?: string | null },
): Promise<StoreMediaRow> {
  const db = storeDb();
  if (!db) throw new Error("store unavailable");

  const fileId = randomUUID();
  const key = productPhotoKey(productId, fileId);
  const derivative = await renderProductPhoto(input);
  await putObject(key, derivative.buffer, "image/webp");

  const { data, error } = await db
    .from("store_product_media")
    .insert({
      product_id: productId,
      kind: "photo",
      r2_key: key,
      original_key: null,
      width: derivative.width,
      height: derivative.height,
      bytes: derivative.bytes,
      alt: opts?.alt ?? null,
      is_public: true,
      position: await nextPosition(productId, "photo"),
    })
    .select("*")
    .single();
  if (error) {
    await deleteObject(key);
    throw new Error(error.message);
  }

  // First photo becomes the product cover if none is set yet.
  const { data: prod } = await db
    .from("store_products")
    .select("cover_image_key")
    .eq("id", productId)
    .maybeSingle();
  if (prod && !prod.cover_image_key) {
    await db.from("store_products").update({ cover_image_key: key, updated_at: new Date().toISOString() }).eq("id", productId);
  }
  return data as StoreMediaRow;
}

/**
 * Store an uploaded sample PDF privately and report its page count. No customer
 * derivative is created yet — the admin then picks which pages to expose.
 */
export async function uploadSamplePdf(
  productId: string,
  pdf: Buffer,
): Promise<{ pdf_key: string; page_count: number }> {
  const pageCount = await getPdfPageCount(pdf); // throws on a non-PDF
  const fileId = randomUUID();
  const key = samplePdfOriginalKey(productId, fileId);
  await putObject(key, pdf, "application/pdf");
  return { pdf_key: key, page_count: pageCount };
}

/**
 * Generate watermarked sample-page derivatives from selected pages of a
 * previously-uploaded private PDF. The original PDF is fetched from R2 by its
 * private key (validated to belong to this product), rasterized page-by-page,
 * watermarked/downscaled, and inserted as sample_page media. Returns created rows.
 */
export async function generateSamplesFromPdf(
  productId: string,
  pdfKey: string,
  pages: number[],
): Promise<StoreMediaRow[]> {
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  if (!isOwnedSamplePdfKey(productId, pdfKey)) throw new Error("invalid PDF reference");

  const obj = await getObject(pdfKey);
  if (!obj) throw new Error("uploaded PDF not found");
  const chunks: Uint8Array[] = [];
  const reader = obj.body.transformToWebStream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const pdf = Buffer.concat(chunks.map((c) => Buffer.from(c)));

  const pageCount = await getPdfPageCount(pdf);
  const selected = normalizePageSelection(pages, pageCount);
  if (!selected.length) throw new Error("Select at least one page");

  const created: StoreMediaRow[] = [];
  let position = await nextPosition(productId, "sample_page");
  for (const pageNo of selected) {
    const png = await rasterizePdfPage(pdf, pageNo);
    const derivative = await renderSamplePageDerivative(png);
    const fileId = randomUUID();
    const derivativeKey = samplePageDerivativeKey(productId, fileId);
    await putObject(derivativeKey, derivative.buffer, "image/webp");
    const { data, error } = await db
      .from("store_product_media")
      .insert({
        product_id: productId,
        kind: "sample_page",
        r2_key: derivativeKey,
        original_key: pdfKey, // the private source PDF (never served)
        width: derivative.width,
        height: derivative.height,
        bytes: derivative.bytes,
        source_page_no: pageNo,
        is_public: false,
        position: position++,
      })
      .select("*")
      .single();
    if (error) {
      await deleteObject(derivativeKey);
      throw new Error(error.message);
    }
    created.push(data as StoreMediaRow);
  }
  return created;
}

/** Delete a media row and its R2 object(s); clears cover if it pointed here. */
export async function deleteProductMedia(id: string): Promise<{ product_id: string } | null> {
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  const { data: row } = await db
    .from("store_product_media")
    .select("id,product_id,kind,r2_key,original_key")
    .eq("id", id)
    .maybeSingle();
  if (!row) return null;

  await db.from("store_product_media").delete().eq("id", id);
  if (row.r2_key) await deleteObject(row.r2_key);
  // Delete the private original only if no other media row still references it
  // (a PDF source is shared across the sample pages generated from it).
  if (row.original_key) {
    const { data: others } = await db
      .from("store_product_media")
      .select("id")
      .eq("original_key", row.original_key)
      .limit(1);
    if (!others?.length) await deleteObject(row.original_key);
  }

  const { data: prod } = await db
    .from("store_products")
    .select("cover_image_key")
    .eq("id", row.product_id)
    .maybeSingle();
  if (prod?.cover_image_key && prod.cover_image_key === row.r2_key) {
    const { data: nextPhoto } = await db
      .from("store_product_media")
      .select("r2_key")
      .eq("product_id", row.product_id)
      .eq("kind", "photo")
      .order("position", { ascending: true })
      .limit(1);
    await db
      .from("store_products")
      .update({ cover_image_key: nextPhoto?.[0]?.r2_key ?? null, updated_at: new Date().toISOString() })
      .eq("id", row.product_id);
  }
  return { product_id: row.product_id };
}

/** Persist a new display order for a product's media of one kind. */
export async function reorderProductMedia(
  productId: string,
  kind: "photo" | "sample_page",
  orderedIds: string[],
): Promise<void> {
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  let position = 0;
  for (const id of orderedIds) {
    await db
      .from("store_product_media")
      .update({ position: position++ })
      .eq("id", id)
      .eq("product_id", productId)
      .eq("kind", kind);
  }
}

/** Set (or clear) which photo is the product cover. */
export async function setProductCover(productId: string, mediaId: string | null): Promise<void> {
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  let key: string | null = null;
  if (mediaId) {
    const { data } = await db
      .from("store_product_media")
      .select("r2_key,kind")
      .eq("id", mediaId)
      .eq("product_id", productId)
      .maybeSingle();
    if (!data || data.kind !== "photo") throw new Error("cover must be a product photo");
    key = data.r2_key;
  }
  await db.from("store_products").update({ cover_image_key: key, updated_at: new Date().toISOString() }).eq("id", productId);
}

/** All media for a product, with resolved customer-facing URLs. */
export async function listProductMedia(productId: string): Promise<
  Array<StoreMediaRow & { url: string | null }>
> {
  const db = storeDb();
  if (!db) return [];
  const { data } = await db
    .from("store_product_media")
    .select("*")
    .eq("product_id", productId)
    .order("kind", { ascending: true })
    .order("position", { ascending: true });
  const { publicCdnUrl } = await import("@/lib/r2");
  // Public photos: CDN when configured, else the same-origin `/media/[...]`
  // stream route (keys are under `media/`). Samples: protected derivative route.
  const photoUrl = (key: string): string | null =>
    publicCdnUrl(key) ?? (key.startsWith("media/") ? `/${key}` : null);
  return (data || []).map((m) => ({
    ...(m as StoreMediaRow),
    url: m.kind === "photo" ? photoUrl(m.r2_key) : `/api/notes/sample/${m.id}`,
  }));
}
