import CourseExplorer from "@/components/public/home/CourseExplorer";
import { getPublishedCourses } from "@/lib/dataProvider";
import { getPurchaseSnapshot, coursePurchaseMap } from "@/lib/purchaseStatus";

export const metadata = { title: "Courses — Naman Sharma IAS Academy" };

// Always render fresh so newly published/edited courses appear immediately
// (otherwise this listing is statically prerendered at build time and goes stale).
export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const courses = await getPublishedCourses();
  const snapshot = await getPurchaseSnapshot();
  const purchaseMap = coursePurchaseMap(courses, snapshot);

  return (
    <div className="bg-[var(--ca-slate-50)]">
      {/* Premium hero */}
      <header className="ca-dark ca-grain relative overflow-hidden">
        <div className="ca-orb" style={{ width: 320, height: 320, top: -130, right: -70, background: "rgba(212,175,55,0.16)" }} />
        <div className="ca-orb" style={{ width: 260, height: 260, bottom: -150, left: -60, background: "rgba(30,58,138,0.5)" }} />
        <div className="container-wide relative py-14 text-center sm:py-20">
          <p className="ca-eyebrow">All Courses</p>
          <h1 className="ca-hero-title mx-auto mt-3 max-w-3xl font-heading text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
            Find your perfect UPSC program
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[var(--ca-slate-300)]">
            Foundation, optionals, mains, test series, mentorship and PCS — fully online, offline or hybrid.
          </p>
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10 -mt-10 rounded-t-[2rem] bg-[var(--ca-slate-50)] sm:-mt-12">
        <div className="container-wide py-10 sm:py-12">
          <CourseExplorer courses={courses} purchaseMap={purchaseMap} />
        </div>
      </div>
    </div>
  );
}
