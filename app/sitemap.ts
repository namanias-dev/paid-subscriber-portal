import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";
import {
  getPublicQuizzes,
  getAllCourses,
  getPublicWebinars,
  getPublicCaArticles,
  getPublicResources,
} from "@/lib/dataProvider";
import { caEffectiveDate } from "@/lib/caView";
import { RESOURCE_CATEGORIES } from "@/lib/resourceConstants";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes = ["", "/courses", "/current-affairs", "/current-affairs/daily", "/current-affairs/monthly", "/quizzes", "/webinars", "/results", "/resources", "/free-resources", "/about", "/contact"].map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: p === "" ? 1 : 0.7,
  }));

  let quizRoutes: MetadataRoute.Sitemap = [];
  try {
    const quizzes = await getPublicQuizzes();
    quizRoutes = quizzes
      .filter((q) => q.is_public && q.status === "published" && q.seo?.include_in_sitemap !== false && q.seo?.indexable !== false)
      .map((q) => ({ url: `${SITE_URL}/quizzes/${q.slug}`, lastModified: q.updated_at ? new Date(q.updated_at) : now, changeFrequency: "daily" as const, priority: 0.6 }));
  } catch { /* ignore */ }

  let courseRoutes: MetadataRoute.Sitemap = [];
  try {
    const courses = await getAllCourses();
    courseRoutes = courses.filter((c) => c.slug).map((c) => ({ url: `${SITE_URL}/courses/${c.slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.6 }));
  } catch { /* ignore */ }

  let webinarRoutes: MetadataRoute.Sitemap = [];
  try {
    const webinars = await getPublicWebinars();
    webinarRoutes = webinars.filter((w) => w.slug).map((w) => ({ url: `${SITE_URL}/webinars/${w.slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.6 }));
  } catch { /* ignore */ }

  let caRoutes: MetadataRoute.Sitemap = [];
  try {
    const articles = await getPublicCaArticles();
    const indexable = articles.filter((a) => a.seo?.noindex !== true);
    const articleUrls = indexable.map((a) => ({
      url: `${SITE_URL}/current-affairs/${a.seo?.canonical_slug?.trim() || a.slug}`,
      lastModified: a.updated_at ? new Date(a.updated_at) : now,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));
    const dates = Array.from(new Set(indexable.map((a) => caEffectiveDate(a))));
    const dateUrls = dates.map((d) => ({ url: `${SITE_URL}/current-affairs/daily/${d}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.4 }));
    const months = Array.from(new Set(indexable.map((a) => caEffectiveDate(a).slice(0, 7))));
    const monthUrls = months.map((m) => ({ url: `${SITE_URL}/current-affairs/monthly/${m}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.4 }));
    const cats = Array.from(new Set(indexable.map((a) => a.category_slug).filter(Boolean) as string[]));
    const catUrls = cats.map((c) => ({ url: `${SITE_URL}/current-affairs/category/${c}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.5 }));
    const tags = Array.from(new Set(indexable.flatMap((a) => a.tags || [])));
    const tagUrls = tags.map((t) => ({ url: `${SITE_URL}/current-affairs/tag/${t}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.3 }));
    caRoutes = [...articleUrls, ...dateUrls, ...monthUrls, ...catUrls, ...tagUrls];
  } catch { /* ignore */ }

  let resourceRoutes: MetadataRoute.Sitemap = [];
  try {
    const resources = await getPublicResources();
    const indexable = resources.filter((r) => r.seo?.noindex !== true);
    const articleUrls = indexable.map((r) => ({
      url: `${SITE_URL}/resources/${r.slug}`,
      lastModified: r.updated_at ? new Date(r.updated_at) : now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));
    // Category cluster pages that actually have published content.
    const usedCats = new Set(indexable.map((r) => r.category).filter(Boolean) as string[]);
    const catUrls = RESOURCE_CATEGORIES.filter((c) => usedCats.has(c.slug)).map((c) => ({
      url: `${SITE_URL}/resources/${c.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
    resourceRoutes = [...articleUrls, ...catUrls];
  } catch { /* ignore */ }

  return [...staticRoutes, ...quizRoutes, ...courseRoutes, ...webinarRoutes, ...caRoutes, ...resourceRoutes];
}
