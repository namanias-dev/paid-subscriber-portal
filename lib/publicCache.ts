import { revalidateTag } from "next/cache";

/**
 * Data-cache tags for public (ISR) content. Mutations that change public pages
 * must call the matching revalidate* helper so publishes show up immediately.
 */
export const PUBLIC_CACHE_TAGS = {
  siteSettings: "public-site-settings",
  caArticles: "public-ca-articles",
  caPdfs: "public-ca-pdfs",
  caTaxonomy: "public-ca-taxonomy",
  resources: "public-resources",
  careers: "public-careers",
  quizzes: "public-quizzes",
  webinars: "public-webinars",
  courses: "public-courses",
} as const;

export type PublicCacheTag = (typeof PUBLIC_CACHE_TAGS)[keyof typeof PUBLIC_CACHE_TAGS];

export function revalidatePublicTags(...tags: PublicCacheTag[]): void {
  for (const tag of tags) revalidateTag(tag);
}

export function revalidatePublicCa(): void {
  revalidatePublicTags(
    PUBLIC_CACHE_TAGS.caArticles,
    PUBLIC_CACHE_TAGS.caPdfs,
    PUBLIC_CACHE_TAGS.caTaxonomy,
  );
}

export function revalidatePublicResources(): void {
  revalidatePublicTags(PUBLIC_CACHE_TAGS.resources, PUBLIC_CACHE_TAGS.caPdfs);
}

export function revalidatePublicSiteSettings(): void {
  revalidatePublicTags(PUBLIC_CACHE_TAGS.siteSettings);
}

export function revalidatePublicCareers(): void {
  revalidatePublicTags(PUBLIC_CACHE_TAGS.careers);
}

export function revalidatePublicCourses(): void {
  revalidatePublicTags(PUBLIC_CACHE_TAGS.courses);
}

export function revalidatePublicWebinars(): void {
  revalidatePublicTags(PUBLIC_CACHE_TAGS.webinars);
}

export function revalidatePublicQuizzes(): void {
  revalidatePublicTags(PUBLIC_CACHE_TAGS.quizzes);
}
