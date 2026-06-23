import { notFound } from "next/navigation";
import type { Metadata } from "next";
import CheckoutClient from "@/components/public/CheckoutClient";
import { getCourseBySlug } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const course = await getCourseBySlug(params.slug);
  return { title: course ? `Enroll · ${course.title}` : "Enroll", robots: { index: false, follow: false } };
}

export default async function CourseEnrollPage({ params }: { params: { slug: string } }) {
  const course = await getCourseBySlug(params.slug);
  if (!course) notFound();
  if (course.status !== "published" || course.active === false) notFound();
  return <CheckoutClient course={course} />;
}
