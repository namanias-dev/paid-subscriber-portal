/**
 * Human-friendly login codes for the buyer portal.
 *
 * Alphabet deliberately excludes ambiguous characters (O/0, I/1/L) so codes are
 * easy to read off a receipt and type on mobile. Codes are convenience-grade
 * (second factor required to retrieve), not cryptographic secrets.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateLoginCode(len = 7): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** Normalize a user-typed login code (uppercase, strip spaces/dashes). */
export function normalizeLoginCode(raw: string | null | undefined): string {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Last N characters of a payment reference, normalized (case-insensitive, no spaces). */
export function normalizeRefLast(raw: string | null | undefined): string {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
