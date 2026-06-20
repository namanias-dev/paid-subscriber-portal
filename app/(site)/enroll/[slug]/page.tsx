import { notFound } from "next/navigation";
import EnrollClient from "@/components/public/EnrollClient";
import { getCourseBySlug } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

export default async function EnrollPage({ params }: { params: { slug: string } }) {
  const course = await getCourseBySlug(params.slug);
  if (!course) notFound();
  return <EnrollClient course={course} />;
}
