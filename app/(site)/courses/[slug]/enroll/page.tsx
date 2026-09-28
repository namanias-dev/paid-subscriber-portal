import { notFound } from "next/navigation";
import type { Metadata } from "next";
import CheckoutClient from "@/components/public/CheckoutClient";
import { getCourseBySlug } from "@/lib/dataProvider";
import { mergeSiteSettings } from "@/lib/homeDefaults";
import { whatsappLink } from "@/lib/phone";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const course = await getCourseBySlug(params.slug);
  return { title: course ? `Enroll · ${course.title}` : "Enroll", robots: { index: false, follow: false } };
}

export default async function CourseEnrollPage({ params }: { params: { slug: string } }) {
  const course = await getCourseBySlug(params.slug);
  if (!course) notFound();
  if (course.status !== "published" || course.active === false) notFound();
  const settings = mergeSiteSettings(null);
  const waLink = whatsappLink(
    settings.brand.whatsapp || settings.brand.support_phone,
    "Hi, I need help choosing a batch.",
  );
  return <CheckoutClient course={course} waLink={waLink} />;
}
