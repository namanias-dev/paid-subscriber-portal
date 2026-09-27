/**
 * Public course availability. The course page, the published-course loader
 * and the sitemap must share this so a URL cannot be listed and 404.
 *
 * Slugs ending in `-old` are not special-cased. A published, active course
 * stays public regardless of its slug.
 */
export function isPublicCourseAvailable(
  course: { slug?: string | null; status?: string | null; active?: boolean | null } | null | undefined,
): boolean {
  if (!course) return false;
  const slug = (course.slug || "").trim();
  return slug.length > 0 && course.status === "published" && course.active !== false;
}
