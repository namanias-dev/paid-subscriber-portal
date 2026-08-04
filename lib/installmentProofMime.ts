/**
 * Magic-byte MIME detection + light EXIF strip for installment proofs.
 * Client-claimed Content-Type is never trusted.
 */
export const INSTALLMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const INSTALLMENT_PROOF_MAX_FILES = 3;
export const INSTALLMENT_PROOF_RATE_LIMIT = 5; // per student / 24h

export type InstallmentProofMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "application/pdf";

const EXT: Record<InstallmentProofMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export function extForMime(mime: InstallmentProofMime): string {
  return EXT[mime];
}

/** Detect real MIME from buffer magic bytes. Returns null if not allowed. */
export function detectInstallmentProofMime(buf: Buffer): InstallmentProofMime | null {
  if (buf.length < 12) return null;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf";
  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  // HEIC/HEIF: ftyp + brand heic/heif/mif1/msf1
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.slice(8, 12).toString("ascii").toLowerCase();
    if (["heic", "heif", "mif1", "msf1", "heix"].includes(brand)) return "image/heic";
  }
  return null;
}

/**
 * Strip JPEG APP1 (EXIF) segments. Other formats passed through —
 * HEIC EXIF needs a decoder we deliberately don't pull into the bundle.
 */
export function stripExifIfJpeg(buf: Buffer, mime: InstallmentProofMime): Buffer {
  if (mime !== "image/jpeg") return buf;
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xda) {
      // SOS — copy rest
      for (let j = i; j < buf.length; j++) out.push(buf[j]);
      return Buffer.from(out);
    }
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      return Buffer.from(out);
    }
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (len < 2 || i + 2 + len > buf.length) break;
    // Skip APP1 (EXIF)
    if (marker !== 0xe1) {
      for (let j = i; j < i + 2 + len; j++) out.push(buf[j]);
    }
    i += 2 + len;
  }
  // Fallback: original if parse failed mid-way
  return buf;
}
