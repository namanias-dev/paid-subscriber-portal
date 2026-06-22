import type { Metadata } from "next";
import { SITE_URL, ACADEMY } from "./config";
import type { CaArticle, CaSeo } from "./types";

export const CA_BASE = `${SITE_URL}/current-affairs`;

/** Build Next metadata for a generic CA route (hub, archives, taxonomy). */
export function caMetadata(opts: {
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

/** Format a YYYY-MM-DD or ISO date for display (en-IN). */
export function caDateLabel(d?: string | null): string {
  if (!d) return "";
  const date = new Date(d.length === 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Format a YYYY-MM month token for display. */
export function caMonthLabel(m?: string | null): string {
  if (!m) return "";
  const date = new Date(`${m}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return m;
  return date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

/** The effective date bucket (YYYY-MM-DD) for an article. */
export function caEffectiveDate(a: CaArticle): string {
  return a.ca_date || (a.publish_at || a.created_at).slice(0, 10);
}

/** Group published articles by date (newest first). */
export function groupByDate(articles: CaArticle[]): { date: string; items: CaArticle[] }[] {
  const map = new Map<string, CaArticle[]>();
  for (const a of articles) {
    const key = caEffectiveDate(a);
    const arr = map.get(key) || [];
    arr.push(a);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .sort((x, y) => (x[0] < y[0] ? 1 : -1))
    .map(([date, items]) => ({ date, items }));
}
