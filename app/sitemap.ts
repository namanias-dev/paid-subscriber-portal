import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";
import { getPublicQuizzes, getAllCourses, getPublicWebinars } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes = ["", "/courses", "/quizzes", "/webinars", "/results", "/free-resources", "/about", "/contact"].map((p) => ({
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

  return [...staticRoutes, ...quizRoutes, ...courseRoutes, ...webinarRoutes];
}
