/**
 * Canonical values for the approved Notes SMS slots. Pure: no database.
 *
 * Every value is derived from the order/lead itself and checked against the
 * value rules in lib/sms/notesApproved before it can reach a template.
 */
import {
  NOTES_SMS_ORIGIN,
  isAllowedNotesUrl,
  isValidNotesAmount,
  isValidNotesSubject,
} from "@/lib/sms/notesApproved";

/**
 * Subject label per live product SKU, in display order. Matches the approved
 * tracker samples ("Indian Polity", "Indian Economy"). A SKU not listed here is
 * refused rather than guessed.
 */
export const NOTES_SUBJECT_BY_SKU: ReadonlyArray<{ sku: string; slug: string; subject: string }> = [
  { sku: "NOTES-POLITY", slug: "polity", subject: "Indian Polity" },
  { sku: "NOTES-MODERN-HISTORY", slug: "modern-history", subject: "Modern History" },
  { sku: "NOTES-ECONOMY", slug: "economy", subject: "Indian Economy" },
];

export interface NotesOrderLine {
  sku: string | null;
  qty: number;
}

export type SubjectResult =
  | { ok: true; subject: string; slugs: string[] }
  | { ok: false; reason: "no_items" | "unknown_product" | "subject_too_long"; detail?: string };

/** "Indian Polity" or "Indian Polity + Indian Economy", in catalogue order. */
export function notesSubjectFromLines(lines: NotesOrderLine[]): SubjectResult {
  const real = lines.filter((l) => Number(l.qty) > 0);
  if (!real.length) return { ok: false, reason: "no_items" };
  const skus = new Set<string>();
  for (const l of real) {
    const sku = String(l.sku || "").trim().toUpperCase();
    if (!NOTES_SUBJECT_BY_SKU.some((m) => m.sku === sku)) {
      return { ok: false, reason: "unknown_product", detail: sku || "(none)" };
    }
    skus.add(sku);
  }
  const picked = NOTES_SUBJECT_BY_SKU.filter((m) => skus.has(m.sku));
  const subject = picked.map((m) => m.subject).join(" + ");
  if (!isValidNotesSubject(subject)) return { ok: false, reason: "subject_too_long", detail: subject };
  return { ok: true, subject, slugs: picked.map((m) => m.slug) };
}

/** Paise → "2499" or "2458.20". Null for anything that is not a positive whole paise amount. */
export function formatNotesAmount(paise: number | null | undefined): string | null {
  const n = Number(paise);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const rupees = Math.floor(n / 100);
  const rest = n % 100;
  const out = rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, "0")}`;
  return isValidNotesAmount(out) ? out : null;
}

export const NOTES_STORE_URL = `${NOTES_SMS_ORIGIN}/notes`;
/**
 * Order tracking entry. Deliberately the public form, not a tokenised link:
 * minting a token for an SMS would rotate the hash and sign the customer's
 * browser out of the confirmation page.
 */
export const NOTES_TRACK_URL = `${NOTES_SMS_ORIGIN}/notes/track`;

/** Product page for a one-subject order, otherwise the store. */
export function notesPaymentUrl(slugs: string[]): string {
  if (slugs.length === 1) {
    const url = `${NOTES_SMS_ORIGIN}/notes/${slugs[0]}`;
    if (isAllowedNotesUrl(url)) return url;
  }
  return NOTES_STORE_URL;
}

/** Last four digits only. */
export function maskNotesPhone(digits10: string | null | undefined): string {
  const d = String(digits10 || "").replace(/\D/g, "");
  return d.length >= 4 ? `••••••${d.slice(-4)}` : "••••";
}
