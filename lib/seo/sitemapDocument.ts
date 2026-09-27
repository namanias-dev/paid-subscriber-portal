import { caEffectiveDate } from "../caView";
import { isPublicCourseAvailable } from "../publicCourse";
import { isPublicIndexableCaArticle, publicCaIndexSlug } from "../publicCaArticle";
import { RESOURCE_CATEGORIES } from "../resourceConstants";
import { seoUrl, truthfulLastModified } from "../seoOrigin";
import { isNotesReservedSlug, notesProductPath } from "../store/paths";
import type { CaArticle, Resource } from "../types";

export interface PublicSitemapEntry {
  url: string;
  lastModified?: Date;
  changeFrequency?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
}

export interface SitemapQuizInput {
  slug?: string | null;
  is_public?: boolean;
  status?: string | null;
  updated_at?: string | null;
  seo?: { include_in_sitemap?: boolean; indexable?: boolean } | null;
}

export interface SitemapCourseInput {
  slug?: string | null;
  status?: string | null;
  active?: boolean | null;
  updated_at?: string | null;
}

export interface SitemapWebinarInput {
  slug?: string | null;
  updated_at?: string | null;
}

export interface SitemapNotesProductInput {
  slug?: string | null;
  updated_at?: string | null;
}

export interface PublicSitemapInput {
  quizzes?: SitemapQuizInput[];
  courses?: SitemapCourseInput[];
  webinars?: SitemapWebinarInput[];
  caArticles?: CaArticle[];
  resources?: Resource[];
  notesProducts?: SitemapNotesProductInput[];
}

const STATIC_PATHS = [
  "",
  "/courses",
  "/current-affairs",
  "/current-affairs/daily",
  "/current-affairs/monthly",
  "/quizzes",
  "/webinars",
  "/results",
  "/resources",
  "/free-resources",
  "/about",
  "/contact",
  "/notes",
] as const;

function entry(
  path: string,
  opts: { lastModified?: Date; changeFrequency: PublicSitemapEntry["changeFrequency"]; priority: number },
): PublicSitemapEntry {
  const row: PublicSitemapEntry = {
    url: seoUrl(path),
    changeFrequency: opts.changeFrequency,
    priority: opts.priority,
  };
  if (opts.lastModified) row.lastModified = opts.lastModified;
  return row;
}

function latest(values: Array<string | null | undefined>): Date | undefined {
  let best: Date | undefined;
  for (const value of values) {
    const date = truthfulLastModified(value);
    if (!date) continue;
    if (!best || date.getTime() > best.getTime()) best = date;
  }
  return best;
}

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function buildPublicSitemap(input: PublicSitemapInput): PublicSitemapEntry[] {
  const notesProducts = (input.notesProducts || []).filter(
    (product) => {
      const slug = (product.slug || "").trim();
      return slug.length > 0 && !isNotesReservedSlug(slug);
    },
  );
  const notesHubStamp = latest(notesProducts.map((product) => product.updated_at));

  const staticRoutes = STATIC_PATHS.map((path) =>
    entry(path, {
      lastModified: path === "/notes" ? notesHubStamp : undefined,
      changeFrequency: "weekly",
      priority: path === "" ? 1 : 0.7,
    }),
  );

  const quizRoutes = (input.quizzes || [])
    .filter(
      (quiz) =>
        !!quiz.slug &&
        quiz.is_public &&
        quiz.status === "published" &&
        quiz.seo?.include_in_sitemap !== false &&
        quiz.seo?.indexable !== false,
    )
    .map((quiz) =>
      entry(`/quizzes/${quiz.slug}`, {
        lastModified: truthfulLastModified(quiz.updated_at),
        changeFrequency: "daily",
        priority: 0.6,
      }),
    );

  const courseRoutes = (input.courses || [])
    .filter((course) => isPublicCourseAvailable(course))
    .map((course) =>
      entry(`/courses/${course.slug}`, {
        lastModified: truthfulLastModified(course.updated_at),
        changeFrequency: "weekly",
        priority: 0.6,
      }),
    );

  const webinarRoutes = (input.webinars || [])
    .filter((webinar) => !!(webinar.slug || "").trim())
    .map((webinar) =>
      entry(`/webinars/${webinar.slug}`, {
        lastModified: truthfulLastModified(webinar.updated_at),
        changeFrequency: "weekly",
        priority: 0.6,
      }),
    );

  const notesRoutes = notesProducts.map((product) =>
    entry(notesProductPath(product.slug || ""), {
      lastModified: truthfulLastModified(product.updated_at),
      changeFrequency: "weekly",
      priority: 0.6,
    }),
  );

  const caArticles = (input.caArticles || []).filter((article) => isPublicIndexableCaArticle(article));
  const caArticleRoutes = caArticles.map((article) =>
    entry(`/current-affairs/${publicCaIndexSlug(article)}`, {
      lastModified: truthfulLastModified(article.updated_at),
      changeFrequency: "daily",
      priority: 0.7,
    }),
  );

  const byDay = new Map<string, CaArticle[]>();
  const byMonth = new Map<string, CaArticle[]>();
  const byCategory = new Map<string, CaArticle[]>();
  const byTag = new Map<string, CaArticle[]>();
  for (const article of caArticles) {
    const day = caEffectiveDate(article);
    if (isDay(day)) {
      const month = day.slice(0, 7);
      byDay.set(day, [...(byDay.get(day) || []), article]);
      byMonth.set(month, [...(byMonth.get(month) || []), article]);
    }
    if (article.category_slug) {
      byCategory.set(article.category_slug, [...(byCategory.get(article.category_slug) || []), article]);
    }
    for (const tag of article.tags || []) {
      if (!tag) continue;
      byTag.set(tag, [...(byTag.get(tag) || []), article]);
    }
  }

  const caDateRoutes = [...byDay.entries()].map(([day, articles]) =>
    entry(`/current-affairs/daily/${day}`, {
      lastModified: latest(articles.map((article) => article.updated_at)),
      changeFrequency: "weekly",
      priority: 0.4,
    }),
  );
  const caMonthRoutes = [...byMonth.entries()].map(([month, articles]) =>
    entry(`/current-affairs/monthly/${month}`, {
      lastModified: latest(articles.map((article) => article.updated_at)),
      changeFrequency: "weekly",
      priority: 0.4,
    }),
  );
  const caCategoryRoutes = [...byCategory.entries()].map(([category, articles]) =>
    entry(`/current-affairs/category/${category}`, {
      lastModified: latest(articles.map((article) => article.updated_at)),
      changeFrequency: "weekly",
      priority: 0.5,
    }),
  );
  const caTagRoutes = [...byTag.entries()].map(([tag, articles]) =>
    entry(`/current-affairs/tag/${tag}`, {
      lastModified: latest(articles.map((article) => article.updated_at)),
      changeFrequency: "weekly",
      priority: 0.3,
    }),
  );

  const resources = (input.resources || []).filter((resource) => resource.seo?.noindex !== true && !!resource.slug);
  const resourceArticleRoutes = resources.map((resource) =>
    entry(`/resources/${resource.slug}`, {
      lastModified: truthfulLastModified(resource.updated_at),
      changeFrequency: "weekly",
      priority: 0.7,
    }),
  );
  const usedCategories = new Map<string, Resource[]>();
  for (const resource of resources) {
    if (!resource.category) continue;
    usedCategories.set(resource.category, [...(usedCategories.get(resource.category) || []), resource]);
  }
  const resourceCategoryRoutes = RESOURCE_CATEGORIES.filter((category) => usedCategories.has(category.slug)).map(
    (category) =>
      entry(`/resources/${category.slug}`, {
        lastModified: latest((usedCategories.get(category.slug) || []).map((resource) => resource.updated_at)),
        changeFrequency: "weekly",
        priority: 0.6,
      }),
  );

  return [
    ...staticRoutes,
    ...quizRoutes,
    ...courseRoutes,
    ...webinarRoutes,
    ...notesRoutes,
    ...caArticleRoutes,
    ...caDateRoutes,
    ...caMonthRoutes,
    ...caCategoryRoutes,
    ...caTagRoutes,
    ...resourceArticleRoutes,
    ...resourceCategoryRoutes,
  ];
}
