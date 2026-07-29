/**
 * SMS-ONLY title shortening for DLT free-text variables.
 *
 * Website title / slug / URL are NEVER read or written here. This module only
 * produces a GSM-7 string safe for `{item_short}` / `{item_name}` slots.
 *
 * Resolution order (see {@link resolveSmsItemShort}):
 *   1. manual sms_short_title (admin)
 *   2. auto-shorten(full title)
 *   3. clamp (last-mile; imported from templates — never remove)
 */
import { clampDltFreeTextVar, DLT_FREE_TEXT_VAR_MAX } from "./templates";

export { DLT_FREE_TEXT_VAR_MAX };

const MONTH_ABBR: ReadonlyArray<[RegExp, string]> = [
  [/\bJanuary\b/gi, "Jan"],
  [/\bFebruary\b/gi, "Feb"],
  [/\bMarch\b/gi, "Mar"],
  [/\bApril\b/gi, "Apr"],
  [/\bMay\b/gi, "May"],
  [/\bJune\b/gi, "Jun"],
  [/\bJuly\b/gi, "Jul"],
  [/\bAugust\b/gi, "Aug"],
  [/\bSeptember\b/gi, "Sep"],
  [/\bOctober\b/gi, "Oct"],
  [/\bNovember\b/gi, "Nov"],
  [/\bDecember\b/gi, "Dec"],
];

/** GSM-7 basic + extension set (same spirit as templates.analyzeBody). */
const GSM_OK = new Set(
  ("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€").split(""),
);

export function isGsm7Text(text: string): boolean {
  for (const ch of text) {
    if (!GSM_OK.has(ch) && ch !== "\u001b") return false;
  }
  return true;
}

/**
 * Map common unicode punctuation to GSM-7 ASCII. Strips any remaining
 * non-GSM7 characters (never invents meaning — just removes unsafe glyphs).
 */
export function toGsm7Ascii(input: string): string {
  let s = String(input ?? "");
  s = s
    .replace(/[\u2013\u2014\u2212\uFE58\uFE63\uFF0D]/g, "-") // dashes → hyphen
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/₹/g, "Rs")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Drop anything still outside GSM-7 (emoji, leftover unicode).
  let out = "";
  for (const ch of s) {
    if (GSM_OK.has(ch) || ch === " ") out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

function tidyDashes(s: string): string {
  return s
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/^[\s-]+|[\s-]+$/g, "")
    .replace(/\s+([,;:.])/g, "$1")
    .trim();
}

/**
 * Deterministic shortener. Preserves trailing year(s). Idempotent when already
 * short / already shortened. Target example:
 *   "UPSC Full Masterclass By Naman Sir - 01 August 2026" (51)
 * → "UPSC Masterclass by Naman Sir - 01 Aug 2026" (43)
 */
export function shortenSmsTitle(input: string, max = DLT_FREE_TEXT_VAR_MAX): string {
  let s = toGsm7Ascii(input);
  if (!s) return s;
  if ([...s].length <= max) return s;

  // Protect trailing year token(s), e.g. "2026" or "2027/28/29".
  const yearRe = /\b(20\d{2}(?:\/\d{2,4})*)\s*$/;
  const ym = s.match(yearRe);
  const year = ym?.[1] ?? "";
  let head = year ? s.slice(0, s.length - year.length).trim() : s;
  head = head.replace(/[\s-]+$/g, "").trim();

  for (const [re, abbr] of MONTH_ABBR) head = head.replace(re, abbr);

  // Phrase-level safe abbreviations (order matters).
  head = head.replace(/\bFull Masterclass\b/gi, "Masterclass");
  head = head.replace(/\bMasterclass By\b/gi, "Masterclass by");
  head = head.replace(/\bMasterclass by\b/g, "Masterclass by"); // normalize case after prior pass
  // Drop leftover standalone "Full" filler (not mid-word).
  head = head.replace(/\bFull\b/gi, "");
  head = tidyDashes(head);

  let out = year ? tidyDashes(`${head} ${year}`) : tidyDashes(head);
  if ([...out].length <= max) return out;

  // Drop mild fillers from the head only (never the year).
  const FILLERS = [/\bthe\b/gi, /\ba\b/gi, /\ban\b/gi, /\bfor\b/gi];
  for (const re of FILLERS) {
    if ([...out].length <= max) break;
    head = tidyDashes(head.replace(re, ""));
    out = year ? tidyDashes(`${head} ${year}`) : tidyDashes(head);
  }

  if ([...out].length <= max) return out;

  // Last resort: word-boundary trim the HEAD only; re-attach year.
  const yearBudget = year ? year.length + 1 : 0;
  const headMax = Math.max(8, max - yearBudget);
  head = clampDltFreeTextVar(head, headMax);
  head = head.replace(/[\s-]+$/g, "").trim();
  out = year ? tidyDashes(`${head} ${year}`) : tidyDashes(head);
  // Absolute ceiling (should already fit).
  if ([...out].length > max) out = clampDltFreeTextVar(out, max);
  return out;
}

export interface ResolveSmsItemShortInput {
  /** Admin-authored SMS-only title (nullable). */
  smsShortTitle?: string | null;
  /** Public full title (website) — used only as shorten input. */
  fullTitle?: string | null;
  /** Already-resolved candidate (e.g. payment.item) when no entity lookup. */
  fallback?: string | null;
  max?: number;
}

/**
 * Resolve the string that goes into `{item_short}` / `{item_name}`:
 *   manual sms_short_title → auto-shorten(full|fallback) → clamp.
 */
export function resolveSmsItemShort(input: ResolveSmsItemShortInput): string {
  const max = input.max ?? DLT_FREE_TEXT_VAR_MAX;
  const manual = (input.smsShortTitle || "").trim();
  if (manual) {
    const cleaned = toGsm7Ascii(manual);
    return clampDltFreeTextVar(cleaned, max);
  }
  const source = (input.fullTitle || input.fallback || "").trim();
  if (!source) return "";
  return clampDltFreeTextVar(shortenSmsTitle(source, max), max);
}
