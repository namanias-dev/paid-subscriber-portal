/**
 * Indexable public origin.
 *
 * https://namanias.com 308-redirects to https://www.namanias.com. Canonicals,
 * Open Graph URLs, sitemap <loc>s and robots.txt must advertise the host that
 * actually serves the page.
 *
 * This is intentionally NOT `SITE_URL`. SMS bodies, WhatsApp/DLT login links,
 * Telegram operational links, analytics event_source_url and the careers admin
 * email still read `SITE_URL` / `NEXT_PUBLIC_SITE_URL`. Payment return URLs do
 * not read either constant (they use `ICICI_EAZYPAY_RETURN_URL`).
 */
export const SEO_ORIGIN = "https://www.namanias.com";

/** Absolute URL on the indexable origin. `path` may be "" or "/". */
export function seoUrl(path: string): string {
  if (!path || path === "/") return SEO_ORIGIN;
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return `${SEO_ORIGIN}${withSlash}`;
}

/**
 * Resolve a CMS canonical override onto the indexable origin.
 * Apex and www absolute URLs are rewritten to www. Root-relative paths are
 * prefixed. A bare relative token cannot name a preferred host, so the page
 * path is used instead.
 */
export function indexableUrl(raw: string | null | undefined, fallbackPath: string): string {
  const value = (raw || "").trim();
  if (!value) return seoUrl(fallbackPath);
  if (value.startsWith("/") && !value.startsWith("//")) return seoUrl(value.split("#")[0]);
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (host === "namanias.com" || host === "www.namanias.com") {
        return seoUrl(`${url.pathname}${url.search}`);
      }
      return value;
    } catch {
      return seoUrl(fallbackPath);
    }
  }
  return seoUrl(fallbackPath);
}

/**
 * A stored timestamp suitable for sitemap lastmod.
 * Missing or unparseable values are omitted. This never reads the clock.
 */
export function truthfulLastModified(value: string | null | undefined): Date | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}
