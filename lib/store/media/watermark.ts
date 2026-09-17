/**
 * Sample-page derivative pipeline (spec §6). UPLOAD PATH ONLY.
 *
 * A sample page exists to prove the notes are worth buying, not to be a free
 * copy of them. So the preview a customer can reach is a different image from the
 * one we were given, in four ways that cannot be undone client-side:
 *
 *   1. Resolution is capped below print usefulness. At 1,000px on the long edge a
 *      page is comfortable to read on a phone and disappointing on paper.
 *   2. The watermark is composited into the pixels. Not an overlay div, not a CSS
 *      background — remove it and you remove the page.
 *   3. All metadata is dropped. sharp discards EXIF unless asked to keep it, and
 *      we never ask, so no scanner model, no timestamps, no GPS.
 *   4. The image is re-encoded to WebP at moderate quality, which also destroys
 *      any residual print fidelity.
 *
 * The original upload is stored under a private prefix and never has a URL. This
 * function is what stands between the two.
 *
 * Never call this on a request path. Watermarking a page per view would burn CPU
 * on every product view and produce nothing new.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

/** Long-edge cap, in pixels. Readable on screen, weak in print. */
export const SAMPLE_MAX_EDGE = 1000;
export const SAMPLE_WEBP_QUALITY = 68;

const TILE_PATH = join(process.cwd(), "assets/store/sample-watermark-tile.png");

let tileCache: Buffer | null = null;

async function watermarkTile(): Promise<Buffer> {
  if (tileCache) return tileCache;
  tileCache = await readFile(TILE_PATH);
  return tileCache;
}

export interface SampleDerivative {
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
  format: string;
}

/**
 * Turn an uploaded page scan into the only version of it that may be served.
 * Throws on an unreadable image rather than storing something unprotected.
 */
export async function renderSamplePageDerivative(input: Buffer): Promise<SampleDerivative> {
  const probe = sharp(input, { failOn: "error" });
  const meta = await probe.metadata();
  if (!meta.width || !meta.height) throw new Error("store: unreadable sample page image");

  // Honour the camera's rotation flag, then drop it with the rest of the metadata.
  const base = sharp(input, { failOn: "error" })
    .rotate()
    .resize({
      width: SAMPLE_MAX_EDGE,
      height: SAMPLE_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" });

  const flattened = await base.toBuffer();
  const dims = await sharp(flattened).metadata();

  const out = await sharp(flattened)
    .composite([{ input: await watermarkTile(), tile: true, blend: "over" }])
    // No withMetadata(): every EXIF, IPTC and XMP block is dropped here.
    .webp({ quality: SAMPLE_WEBP_QUALITY, effort: 5 })
    .toBuffer();

  const outMeta = await sharp(out).metadata();
  return {
    buffer: out,
    width: outMeta.width || dims.width || 0,
    height: outMeta.height || dims.height || 0,
    bytes: out.length,
    format: outMeta.format || "webp",
  };
}

/** Private R2 prefix for the untouched upload. Never served, never signed. */
export function samplePageOriginalKey(productId: string, fileId: string, ext: string): string {
  return `store-private/sample-originals/${productId}/${fileId}.${ext.replace(/^\./, "")}`;
}

/** The watermarked derivative. Served only through the store's own route. */
export function samplePageDerivativeKey(productId: string, fileId: string): string {
  return `store-private/sample-pages/${productId}/${fileId}.webp`;
}

/**
 * Product photography. Same metadata stripping and re-encode, no watermark:
 * these are marketing images and are meant to be shared.
 */
export async function renderProductPhoto(input: Buffer, maxEdge = 1600): Promise<SampleDerivative> {
  const out = await sharp(input, { failOn: "error" })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .webp({ quality: 80, effort: 5 })
    .toBuffer();
  const meta = await sharp(out).metadata();
  return { buffer: out, width: meta.width || 0, height: meta.height || 0, bytes: out.length, format: "webp" };
}
