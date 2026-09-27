/**
 * Public current-affairs eligibility. The article page, the public loader
 * and the sitemap must share this so a listed URL is one the page can render
 * and index.
 *
 * The indexable path is `seo.canonical_slug` when set, otherwise `slug`.
 * The page resolves either value. A canonical alias that the page cannot
 * open must not be emitted on its own.
 */

export interface PublicCaArticleGate {
  slug?: string | null;
  status?: string | null;
  publish_at?: string | null;
  seo?: { noindex?: boolean; canonical_slug?: string | null } | null;
}

export function isCaPublished(
  article: PublicCaArticleGate | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!article) return false;
  if (article.status !== "published") return false;
  if (article.publish_at && new Date(article.publish_at).getTime() > now) return false;
  return true;
}

/** Slug of the URL the article page advertises as canonical. */
export function publicCaIndexSlug(article: PublicCaArticleGate): string {
  return (article.seo?.canonical_slug?.trim() || article.slug || "").trim();
}

/** Published, not scheduled for the future, not noindex, and has a public slug. */
export function isPublicIndexableCaArticle(
  article: PublicCaArticleGate | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!isCaPublished(article, now)) return false;
  if (article?.seo?.noindex === true) return false;
  return publicCaIndexSlug(article as PublicCaArticleGate).length > 0;
}

/**
 * Article for a public `/current-affairs/[slug]` request.
 * Exact `slug` wins over another row's `canonical_slug`.
 */
export function resolvePublicCaArticle<T extends PublicCaArticleGate>(
  articles: readonly T[],
  requested: string,
  now: number = Date.now(),
): T | null {
  const slug = requested.trim();
  if (!slug) return null;
  const published = articles.filter((article) => isCaPublished(article, now));
  const bySlug = published.find((article) => (article.slug || "").trim() === slug);
  if (bySlug) return bySlug;
  return published.find((article) => (article.seo?.canonical_slug || "").trim() === slug) ?? null;
}
