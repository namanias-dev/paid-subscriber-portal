import sanitize from "sanitize-html";

/**
 * Sanitize rich HTML (from the TipTap editor) before storing/rendering.
 * Uses `sanitize-html` (pure CommonJS) so it runs cleanly in Next.js serverless
 * functions — unlike isomorphic-dompurify, which is ESM-only and throws
 * ERR_REQUIRE_ESM at runtime on Vercel.
 *
 * Allowlist covers the editor's feature set: headings, formatting, lists,
 * blockquotes, tables, links, images and dividers. Scripts, styles, iframes and
 * event handlers are always stripped.
 */
const OPTIONS: sanitize.IOptions = {
  allowedTags: [
    "h2", "h3", "h4", "p", "strong", "b", "em", "i", "u", "s",
    "ul", "ol", "li", "blockquote",
    "table", "thead", "tbody", "tr", "th", "td",
    "a", "img", "hr", "br", "span", "code", "pre",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "title"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
    "*": ["class"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  transformTags: {
    a: sanitize.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
  },
};

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitize(html, OPTIONS);
}

/** True when the sanitized HTML has any meaningful (non-whitespace) text or media. */
export function hasRichContent(html: string | null | undefined): boolean {
  const clean = sanitizeHtml(html);
  if (!clean) return false;
  const stripped = clean.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return stripped.length > 0 || /<(img|hr|table)/i.test(clean);
}
