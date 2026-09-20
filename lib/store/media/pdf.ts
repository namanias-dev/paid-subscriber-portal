/**
 * PDF → page-image rasterization for the Notes sample-preview pipeline.
 *
 * Uses mupdf (WASM — no native binaries, so it runs on Vercel serverless). ADMIN
 * UPLOAD PATH ONLY: the uploaded PDF is stored privately and never served; this
 * turns selected pages into PNG buffers which then flow through the existing
 * `renderSamplePageDerivative` (watermark + downscale + EXIF strip). The customer
 * only ever reaches the watermarked WebP derivative via the protected route.
 */

/** Absolute cap on sample pages a customer can preview (spec §6). */
export const MAX_SAMPLE_PAGES = 10;

/** DPI used when rasterizing; kept modest — derivatives are downscaled anyway. */
const RASTER_DPI = 150;

type MupdfModule = typeof import("mupdf");

let mupdfPromise: Promise<MupdfModule> | null = null;
function loadMupdf(): Promise<MupdfModule> {
  if (!mupdfPromise) mupdfPromise = import("mupdf");
  return mupdfPromise;
}

/** Number of pages in a PDF. Throws on an unreadable/non-PDF buffer. */
export async function getPdfPageCount(pdf: Buffer): Promise<number> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  try {
    const n = doc.countPages();
    if (!Number.isFinite(n) || n < 1) throw new Error("store: PDF has no pages");
    return n;
  } finally {
    (doc as { destroy?: () => void }).destroy?.();
  }
}

/**
 * Rasterize one page (1-based) of a PDF to a PNG buffer. The PNG is an
 * intermediate only — it is immediately handed to the watermark pipeline.
 */
export async function rasterizePdfPage(pdf: Buffer, pageNo: number): Promise<Buffer> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  try {
    const count = doc.countPages();
    const idx = Math.floor(pageNo) - 1;
    if (idx < 0 || idx >= count) throw new Error(`store: page ${pageNo} out of range (1–${count})`);
    const page = doc.loadPage(idx);
    const scale = RASTER_DPI / 72;
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    const png = Buffer.from(pix.asPNG());
    (pix as { destroy?: () => void }).destroy?.();
    (page as { destroy?: () => void }).destroy?.();
    return png;
  } finally {
    (doc as { destroy?: () => void }).destroy?.();
  }
}

/** Validate and normalize a requested page selection against a page count. */
export function normalizePageSelection(pages: unknown, pageCount: number): number[] {
  const arr = Array.isArray(pages) ? pages : [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const p of arr) {
    const n = Math.floor(Number(p));
    if (Number.isFinite(n) && n >= 1 && n <= pageCount && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  out.sort((a, b) => a - b);
  return out.slice(0, MAX_SAMPLE_PAGES);
}
