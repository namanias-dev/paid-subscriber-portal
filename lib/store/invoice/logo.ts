/** Public academy mark already used by the site header. Invoices reuse it. */
export const ACADEMY_LOGO_URL =
  "https://xqwdfyzerzsllqiyzxem.supabase.co/storage/v1/object/public/media/branding/1782023195293-rb3jnw.png";

const MAX_BYTES = 1_500_000;

function png(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function rasterImage(bytes: Uint8Array): boolean {
  if (png(bytes)) return true;
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  return bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
}

/**
 * Trim near-white or transparent padding and scale the mark for a small header.
 * The source file is not modified. Failure returns null so the PDF still issues.
 */
export async function prepareInvoiceLogo(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const sharp = (await import("sharp")).default;
    const source = sharp(Buffer.from(bytes)).rotate();
    const meta = await source.metadata();
    const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = Buffer.from(data);
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      if (r >= 245 && g >= 245 && b >= 245) pixels[i + 3] = 0;
    }
    const trimmed = await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } })
      .trim({ threshold: 1 })
      .resize({ height: 168, width: 840, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    if (!trimmed.length || trimmed.length > MAX_BYTES) return null;
    void meta;
    return new Uint8Array(trimmed);
  } catch {
    return null;
  }
}

/** Best-effort PNG for the PDF header. A failure leaves the supplier name in place. */
export async function loadInvoiceLogo(configuredUrl: string | null): Promise<Uint8Array | null> {
  const url = (configuredUrl || ACADEMY_LOGO_URL).trim();
  if (!url.startsWith("https://")) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").toLowerCase();
    const allowed = !type || ["png", "jpeg", "jpg", "webp", "octet-stream"].some((kind) => type.includes(kind));
    if (!allowed) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES || !rasterImage(bytes)) return null;
    return (await prepareInvoiceLogo(bytes)) || null;
  } catch {
    return null;
  }
}
