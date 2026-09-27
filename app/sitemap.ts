import type { MetadataRoute } from "next";
import {
  getPublicQuizzes,
  getPublishedCourses,
  getPublicWebinars,
  getPublicCaArticles,
  getPublicResources,
} from "@/lib/dataProvider";
import { buildPublicSitemap, type PublicSitemapEntry } from "@/lib/seo/sitemapDocument";
import { listStorefrontProducts } from "@/lib/store/catalogue";

export const dynamic = "force-dynamic";

function updatedAt(row: object): string | null {
  const value = (row as { updated_at?: unknown }).updated_at;
  if (typeof value === "string") return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return null;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let quizzes: Awaited<ReturnType<typeof getPublicQuizzes>> = [];
  try {
    quizzes = await getPublicQuizzes();
  } catch { /* ignore */ }

  let courses: Awaited<ReturnType<typeof getPublishedCourses>> = [];
  try {
    courses = await getPublishedCourses();
  } catch { /* ignore */ }

  let webinars: Awaited<ReturnType<typeof getPublicWebinars>> = [];
  try {
    webinars = await getPublicWebinars();
  } catch { /* ignore */ }

  let caArticles: Awaited<ReturnType<typeof getPublicCaArticles>> = [];
  try {
    caArticles = await getPublicCaArticles();
  } catch { /* ignore */ }

  let resources: Awaited<ReturnType<typeof getPublicResources>> = [];
  try {
    resources = await getPublicResources();
  } catch { /* ignore */ }

  let notesProducts: { slug: string; updated_at: string | null }[] = [];
  try {
    const products = await listStorefrontProducts();
    notesProducts = products
      .filter((product) => product.slug)
      .map((product) => ({ slug: product.slug, updated_at: product.updated_at ?? null }));
  } catch { /* ignore */ }

  const entries: PublicSitemapEntry[] = buildPublicSitemap({
    quizzes: quizzes.map((quiz) => ({
      slug: quiz.slug,
      is_public: quiz.is_public,
      status: quiz.status,
      updated_at: quiz.updated_at,
      seo: quiz.seo,
    })),
    courses: courses.map((course) => ({
      slug: course.slug,
      status: course.status,
      active: course.active,
      updated_at: updatedAt(course),
    })),
    webinars: webinars.map((webinar) => ({
      slug: webinar.slug,
      updated_at: updatedAt(webinar),
    })),
    caArticles,
    resources,
    notesProducts,
  });

  return entries;
}
