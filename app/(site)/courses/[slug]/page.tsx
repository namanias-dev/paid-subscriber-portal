import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CourseDetail from "@/components/public/CourseDetail";
import { getCourseBySlug, getPublishedCourses, getLibraryDocsByIds } from "@/lib/dataProvider";
import { getPurchaseSnapshot, coursePurchaseView } from "@/lib/purchaseStatus";
import { buildLandingView } from "@/lib/landingView";
import { SITE_URL, ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const course = await getCourseBySlug(params.slug);
  if (!course || course.status !== "published" || course.active === false) {
    return { title: "Course not found" };
  }
  const seo = course.seo || {};
  const canonicalSlug = seo.canonical_slug?.trim() || course.slug;
  const url = `${SITE_URL}/courses/${canonicalSlug}`;
  const title = seo.title?.trim() || `${course.title} — ${course.category} | ${ACADEMY.shortName}`;
  const desc = (seo.description?.trim() || course.description || `Join ${course.title} at ${ACADEMY.name}.`).slice(0, 170);
  const cover = seo.og_image?.trim() || course.cover_image_url || course.image;
  const images = cover ? [{ url: cover, width: 1200, height: 630, alt: course.title }] : [];
  return {
    title,
    description: desc,
    keywords: seo.keywords?.trim() || undefined,
    alternates: { canonical: url },
    openGraph: { title, description: desc, url, type: "website", siteName: ACADEMY.name, images },
    twitter: { card: "summary_large_image", title, description: desc, images: images.map((i) => i.url) },
  };
}

export default async function CoursePage({ params }: { params: { slug: string } }) {
  const course = await getCourseBySlug(params.slug);
  if (!course || course.status !== "published" || course.active === false) notFound();

  const all = await getPublishedCourses();
  const related = all.filter((c) => c.category === course.category && c.id !== course.id).slice(0, 2);
  const comparison =
    course.category === "Foundation" ? all.filter((c) => c.category === "Foundation") : [];

  const brochures = await getLibraryDocsByIds(course.brochure_ids);
  const snapshot = await getPurchaseSnapshot();
  const purchase = coursePurchaseView(course, snapshot);
  const view = buildLandingView(course);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: course.title,
    description: course.description || undefined,
    image: course.seo?.og_image || course.cover_image_url || course.image || undefined,
    provider: { "@type": "Organization", name: ACADEMY.name, sameAs: SITE_URL },
    offers: {
      "@type": "Offer",
      price: course.price,
      priceCurrency: "INR",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/courses/${course.slug}`,
      category: course.category,
    },
    ...(course.price > 0 ? { hasCourseInstance: { "@type": "CourseInstance", courseMode: course.modes.join(", ") } } : {}),
    ...(view.ratingAvg && view.ratingCount
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: view.ratingAvg, reviewCount: view.ratingCount } }
      : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <CourseDetail course={course} related={related} comparison={comparison} view={view} brochures={brochures} purchase={purchase} />
    </>
  );
}
