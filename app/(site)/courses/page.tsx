import CourseExplorer from "@/components/public/home/CourseExplorer";
import Reveal from "@/components/ui/Reveal";
import { getPublishedCourses } from "@/lib/dataProvider";

export const metadata = { title: "Courses — Naman Sharma IAS Academy" };

// Always render fresh so newly published/edited courses appear immediately
// (otherwise this listing is statically prerendered at build time and goes stale).
export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const courses = await getPublishedCourses();
  return (
    <div className="container-wide section">
      <Reveal>
        <p className="pill pill-blue mb-3">All Courses</p>
        <h1 className="text-4xl font-extrabold sm:text-5xl">Find your perfect UPSC program</h1>
        <p className="mt-3 max-w-2xl text-ink2">
          Foundation, optionals, mains, test series, mentorship and PCS — fully online, offline or hybrid.
        </p>
      </Reveal>
      <div className="mt-10">
        <CourseExplorer courses={courses} />
      </div>
    </div>
  );
}
