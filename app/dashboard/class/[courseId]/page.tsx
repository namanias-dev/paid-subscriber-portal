import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import { getEnrollments, getAllCourses, getLibraryDocsByIds } from "@/lib/dataProvider";
import { hasCourseAccess } from "@/lib/courseAccess";
import { resolveLearner } from "@/lib/entitlements";
import { getClassHubSectionsForCourse, getClassHubPerformance } from "@/lib/classHubServer";
import ClassHubContent from "@/components/dashboard/ClassHubContent";
import ClassHubBatch from "@/components/dashboard/ClassHubBatch";

export const dynamic = "force-dynamic";

export default async function ClassHubPage({ params }: { params: { courseId: string } }) {
  const learner = await resolveLearner();
  if (!learner) redirect("/login");

  const courses = await getAllCourses();
  const course = courses.find((c) => c.id === params.courseId);
  if (!course) {
    return <LockedOrMissing title="Course not found" subtitle="This course is no longer available." />;
  }

  const isStaff = learner.kind === "staff";
  // Access gate: staff via comp grant; students via their active enrolment; other
  // learners via their validity-filtered course set. Student path is unchanged.
  let access: boolean;
  if (isStaff) {
    access = learner.courseIds.includes(course.id);
  } else if (learner.kind === "student" && learner.studentId) {
    const enrollments = await getEnrollments(learner.studentId);
    access = hasCourseAccess(course.id, { enrollments });
  } else {
    access = learner.courseIds.includes(course.id);
  }
  if (!access) {
    return (
      <LockedOrMissing
        title="Class Hub is locked"
        subtitle={`Enroll in "${course.title}" to unlock live classes, orientation videos and study material.`}
        cta={{ href: `/courses/${course.slug}`, label: "View course" }}
      />
    );
  }

  const ar = course.after_registration || {};
  const docs = await getLibraryDocsByIds([...(ar.doc_ids || []), ...(course.brochure_ids || [])]);
  const [sections, performance] = await Promise.all([
    getClassHubSectionsForCourse(course.id, learner),
    getClassHubPerformance(course.id, learner, courses),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/dashboard/my-courses" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink2 hover:text-primary">
        <ArrowLeft size={15} /> My Courses
      </Link>

      {isStaff && (
        <div className="flex items-center gap-2 rounded-xl border border-[rgba(212,175,55,0.35)] bg-[rgba(212,175,55,0.1)] px-4 py-2.5 text-sm font-semibold text-[var(--ca-gold)]">
          <ShieldCheck size={16} /> Staff access — internal preview of this batch (not a purchase).
        </div>
      )}

      {/* Hero */}
      <section className="ca-dark ca-grain relative overflow-hidden rounded-2xl p-6 sm:p-8">
        <div className="ca-orb" style={{ width: 220, height: 220, top: -110, right: -50, background: "rgba(212,175,55,0.18)" }} />
        <div className="relative">
          <p className="ca-eyebrow">Class Hub</p>
          <h1 className="ca-hero-title mt-2 font-heading text-2xl font-extrabold leading-tight sm:text-3xl">{course.title}</h1>
          <p className="mt-3 max-w-2xl text-[var(--ca-slate-300)]">Everything you need for this batch — live classes, recordings, notes, tests and current affairs.</p>
        </div>
      </section>

      <ClassHubContent course={course} docs={docs} />

      <ClassHubBatch courseId={course.id} sections={sections} performance={performance} />
    </div>
  );
}

function LockedOrMissing({ title, subtitle, cta }: { title: string; subtitle: string; cta?: { href: string; label: string } }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-surface2 text-ink2"><Lock size={24} /></div>
      <h1 className="mt-4 font-heading text-xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-ink2">{subtitle}</p>
      {cta && <Link href={cta.href} className="btn btn-primary mt-5 text-sm">{cta.label}</Link>}
    </div>
  );
}
