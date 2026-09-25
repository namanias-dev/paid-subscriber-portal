/** Public academy mark already used by the site header. Invoices reuse it. */
export const ACADEMY_LOGO_URL =
  "https://xqwdfyzerzsllqiyzxem.supabase.co/storage/v1/object/public/media/branding/1782023195293-rb3jnw.png";

const MAX_BYTES = 1_500_000;

function png(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

/** Best-effort PNG for the PDF header. A failure leaves the supplier name in place. */
export async function loadInvoiceLogo(configuredUrl: string | null): Promise<Uint8Array | null> {
  const url = (configuredUrl || ACADEMY_LOGO_URL).trim();
  if (!url.startsWith("https://")) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (type && !type.includes("png") && !type.includes("octet-stream")) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES || !png(bytes)) return null;
    try {
      const sharp = (await import("sharp")).default;
      const smaller = await sharp(Buffer.from(bytes)).resize({ width: 480, withoutEnlargement: true }).png().toBuffer();
      return new Uint8Array(smaller);
    } catch {
      return bytes;
    }
  } catch {
    return null;
  }
}
