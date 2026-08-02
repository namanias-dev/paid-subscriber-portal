/**
 * Telegram compose/render — HTML parse_mode, per-recipient vars + fallbacks.
 * Preview and send MUST share prepareOutboundHtml.
 */
export const TELEGRAM_VARS = [
  { key: "first_name", label: "first_name", fallback: "there" },
  { key: "name", label: "name", fallback: "there" },
  { key: "course", label: "course", fallback: "your course" },
  { key: "course_link_1", label: "course_link_1", fallback: "https://www.namanias.com/courses" },
  { key: "course_link_2", label: "course_link_2", fallback: "https://www.namanias.com/courses" },
  { key: "webinar_link", label: "webinar_link", fallback: "https://www.namanias.com/webinars" },
  { key: "webinar_date", label: "webinar_date", fallback: "soon" },
  { key: "amount", label: "amount", fallback: "" },
  { key: "coupon", label: "coupon", fallback: "" },
] as const;

export type TelegramVarKey = (typeof TELEGRAM_VARS)[number]["key"];

export const DEFAULT_FALLBACKS: Record<string, string> = Object.fromEntries(
  TELEGRAM_VARS.map((v) => [v.key, v.fallback]),
);

export const TEXT_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const ALLOWED_TAG_RE =
  /<\/?(?:b|strong|i|em|u|s|strike|del|code|pre|blockquote|tg-spoiler)(?:\s[^>]*)?>|<\/?a\s+href="[^"]*"(?:\s[^>]*)?>|<\/a>/gi;

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape everything, then restore Telegram-allowed HTML tags we intentionally emit. */
export function sanitizeTelegramHtml(input: string): string {
  const tokens: string[] = [];
  const withSlots = String(input || "").replace(ALLOWED_TAG_RE, (tag) => {
    const i = tokens.length;
    tokens.push(tag);
    return `\u0000TG${i}\u0000`;
  });
  return escapeHtml(withSlots).replace(/\u0000TG(\d+)\u0000/g, (_m, n) => tokens[Number(n)] || "");
}

export function extractVars(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(template || ""))) {
    const key = m[1]!;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

export function charLimit(hasImage: boolean): number {
  return hasImage ? CAPTION_LIMIT : TEXT_LIMIT;
}

export interface PrepareResult {
  html: string;
  plainLength: number;
  usedFallbacks: string[];
  missingVars: string[];
  overLimit: boolean;
  limit: number;
}

/**
 * Shared preview≡send path.
 * - Resolves {{vars}} with fallbacks (never leaves raw tokens or "undefined")
 * - Escapes variable values for HTML
 * - Sanitizes to Telegram-safe HTML
 */
export function prepareOutboundHtml(
  template: string,
  vars: Record<string, string | number | null | undefined> = {},
  fallbacks: Record<string, string> = {},
  opts: { hasImage?: boolean } = {},
): PrepareResult {
  const fb = { ...DEFAULT_FALLBACKS, ...fallbacks };
  const usedFallbacks: string[] = [];
  const missingVars: string[] = [];
  const re = new RegExp(PLACEHOLDER_RE.source, "g");

  const replaced = String(template || "").replace(re, (_full, key: string) => {
    const raw = vars[key];
    const has =
      raw !== undefined &&
      raw !== null &&
      String(raw).trim() !== "" &&
      String(raw).toLowerCase() !== "undefined";
    if (!has) {
      missingVars.push(key);
      const fallback = fb[key] ?? "";
      if (fallback) usedFallbacks.push(key);
      return escapeHtml(fallback);
    }
    return escapeHtml(String(raw));
  });

  const cleaned = replaced.replace(/\{\{[^}]*\}\}/g, "");
  const html = sanitizeTelegramHtml(cleaned);
  const plainLength = html.replace(/<[^>]+>/g, "").length;
  const limit = charLimit(!!opts.hasImage);

  return {
    html,
    plainLength,
    usedFallbacks: [...new Set(usedFallbacks)],
    missingVars: [...new Set(missingVars)],
    overLimit: html.length > limit,
    limit,
  };
}

export function wrapHtmlTag(
  text: string,
  tag: "b" | "i" | "s" | "tg-spoiler" | "code" | "blockquote",
): string {
  return `<${tag}>${text}</${tag}>`;
}

export function wrapHtmlLink(text: string, url: string): string {
  const safe = escapeHtml(url).replace(/"/g, "&quot;");
  return `<a href="${safe}">${text}</a>`;
}

export function wrapHtmlList(text: string, ordered: boolean): string {
  const lines = text.split(/\n/).filter((l) => l.trim());
  if (!lines.length) return text;
  return lines
    .map((l, i) => (ordered ? `${i + 1}. ${l.trim()}` : `• ${l.trim()}`))
    .join("\n");
}
