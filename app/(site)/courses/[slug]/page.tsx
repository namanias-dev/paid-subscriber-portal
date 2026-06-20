import { notFound } from "next/navigation";
import CourseDetail from "@/components/public/CourseDetail";
import { getCourseBySlug, getPublishedCourses } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

export default async function CoursePage({ params }: { params: { slug: string } }) {
  const course = await getCourseBySlug(params.slug);
  if (!course || course.status !== "published") notFound();

  const all = await getPublishedCourses();
  const related = all.filter((c) => c.category === course.category && c.id !== course.id).slice(0, 2);
  const comparison =
    course.category === "Foundation" ? all.filter((c) => c.category === "Foundation") : [];

  return <CourseDetail course={course} related={related} comparison={comparison} />;
}
