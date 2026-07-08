import type { Metadata } from "next";
import { SITE_URL, ACADEMY } from "./config";
import type { CaSeo, Resource } from "./types";

export const RES_BASE = `${SITE_URL}/resources`;

/** Build Next metadata for a Resources route (hub, cluster, article). */
export function resourceMetadata(opts: {
  title: string;
  description: string;
  path: string;
  seo?: CaSeo | null;
  image?: string | null;
  indexable?: boolean;
}): Metadata {
  const seo = opts.seo || {};
  const title = seo.title?.trim() || opts.title;
  const description = (seo.description?.trim() || opts.description).slice(0, 180);
  const canonical = seo.canonical_override?.trim() || `${SITE_URL}${opts.path}`;
  const ogImage = seo.og_image?.trim() || opts.image || undefined;
  const images = ogImage ? [{ url: ogImage, width: 1200, height: 630, alt: title }] : [];
  const noindex = seo.noindex || opts.indexable === false;
  return {
    title,
    description,
    keywords: seo.keywords?.trim() || undefined,
    alternates: { canonical },
    robots: noindex ? { index: false, follow: !seo.nofollow } : undefined,
    openGraph: {
      title: seo.og_title?.trim() || title,
      description: seo.og_description?.trim() || description,
      url: canonical,
      type: "article",
      siteName: ACADEMY.name,
      images,
    },
    twitter: { card: "summary_large_image", title, description, images: images.map((i) => i.url) },
  };
}

/** Resources that belong to the chronological journey, in read order. */
export function journeyResources(all: Resource[]): Resource[] {
  return all
    .filter((r) => (r.journey_stage || "").trim())
    .sort((a, b) => (a.order_index ?? 999) - (b.order_index ?? 999));
}

/** Group journey resources by their stage label (stage order preserved). */
export function groupByStage(all: Resource[]): { stage: string; items: Resource[] }[] {
  const ordered = journeyResources(all);
  const map = new Map<string, Resource[]>();
  for (const r of ordered) {
    const key = (r.journey_stage || "Other").trim();
    const arr = map.get(key) || [];
    arr.push(r);
    map.set(key, arr);
  }
  return Array.from(map.entries()).map(([stage, items]) => ({ stage, items }));
}

/**
 * Compute the "related content" set for an article by overlap of category,
 * subject, tags and focus keyword — the core of white-hat internal linking.
 * Admin-selected related slugs always win and appear first.
 */
export function computeRelatedResources(article: Resource, all: Resource[], limit = 4): Resource[] {
  const others = all.filter((r) => r.id !== article.id && r.slug !== article.slug);
  const picked: Resource[] = [];
  const seen = new Set<string>();

  // 1) Explicit admin selections first.
  for (const slug of article.related?.resource_slugs || []) {
    const found = others.find((r) => r.slug === slug);
    if (found && !seen.has(found.id)) {
      picked.push(found);
      seen.add(found.id);
    }
  }

  // 2) Score the rest by overlap.
  const tagSet = new Set(article.tags || []);
  const focus = (article.focus_keyword || "").toLowerCase();
  const scored = others
    .filter((r) => !seen.has(r.id))
    .map((r) => {
      let score = 0;
      if (r.category && r.category === article.category) score += 3;
      if (r.subject && r.subject === article.subject) score += 2;
      score += (r.tags || []).filter((t) => tagSet.has(t)).length * 2;
      if (focus && (r.title.toLowerCase().includes(focus) || (r.focus_keyword || "").toLowerCase() === focus)) score += 2;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { r } of scored) {
    if (picked.length >= limit) break;
    picked.push(r);
    seen.add(r.id);
  }
  return picked.slice(0, limit);
}

/**
 * Suggest internal links for an article the admin can approve (used in the CMS).
 * Returns candidate resources ranked by keyword/tag/category overlap.
 */
export function suggestInternalLinks(
  draft: { title?: string; category?: string | null; subject?: string | null; tags?: string[]; focus_keyword?: string | null; slug?: string },
  all: Resource[],
  limit = 6,
): { slug: string; title: string; reason: string }[] {
  const tagSet = new Set(draft.tags || []);
  const focus = (draft.focus_keyword || "").toLowerCase();
  const title = (draft.title || "").toLowerCase();
  return all
    .filter((r) => r.slug !== draft.slug && r.status === "published")
    .map((r) => {
      const reasons: string[] = [];
      let score = 0;
      if (r.category && r.category === draft.category) { score += 3; reasons.push("same category"); }
      if (r.subject && r.subject === draft.subject) { score += 2; reasons.push("same subject"); }
      const shared = (r.tags || []).filter((t) => tagSet.has(t));
      if (shared.length) { score += shared.length * 2; reasons.push(`tags: ${shared.join(", ")}`); }
      if (focus && r.title.toLowerCase().includes(focus)) { score += 2; reasons.push("keyword in title"); }
      if (title && r.focus_keyword && title.includes(r.focus_keyword.toLowerCase())) { score += 2; reasons.push("targets its keyword"); }
      return { slug: r.slug, title: r.title, reason: reasons.join(" · "), score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ slug, title, reason }) => ({ slug, title, reason }));
}
