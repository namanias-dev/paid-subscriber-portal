import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize rich HTML (from the TipTap editor) before storing/rendering.
 * Allowlist covers the editor's feature set: headings, formatting, lists,
 * blockquotes, tables, links, images, and dividers. Scripts, styles, iframes
 * and event handlers are always stripped.
 */
const CONFIG = {
  ALLOWED_TAGS: [
    "h2",
    "h3",
    "h4",
    "p",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "blockquote",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "a",
    "img",
    "hr",
    "br",
    "span",
    "code",
    "pre",
  ],
  ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "title", "class", "colspan", "rowspan"],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ["target"],
};

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  // DOMPurify returns a string here (no RETURN_DOM/RETURN_DOM_FRAGMENT set).
  return DOMPurify.sanitize(html, CONFIG) as unknown as string;
}

/** True when the sanitized HTML has any meaningful (non-whitespace) text or media. */
export function hasRichContent(html: string | null | undefined): boolean {
  const clean = sanitizeHtml(html);
  if (!clean) return false;
  const stripped = clean.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return stripped.length > 0 || /<(img|hr|table)/i.test(clean);
}
