import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Lock } from "lucide-react";
import { getBuyerSession } from "@/lib/session";
import { getAllCourses, getLibraryDocsByIds, paidCourseIdsForPhone } from "@/lib/dataProvider";
import { hasCourseAccess } from "@/lib/courseAccess";
import { resolveLearner } from "@/lib/entitlements";
import { getClassHubSectionsForCourse } from "@/lib/classHubServer";
import ClassHubContent from "@/components/dashboard/ClassHubContent";
import ClassHubBatch from "@/components/dashboard/ClassHubBatch";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Class Hub", robots: { index: false, follow: false } };

export default async function PortalClassHubPage({ params }: { params: { courseId: string } }) {
  const session = await getBuyerSession();
  if (!session) redirect(`/portal/login?next=${encodeURIComponent(`/portal/class/${params.courseId}`)}`);

  const [courses, paidCourseIds] = await Promise.all([
    getAllCourses(),
    paidCourseIdsForPhone(session.phone),
  ]);
  const course = courses.find((c) => c.id === params.courseId);

  if (!course) {
    return <Locked title="Course not found" subtitle="This course is no longer available." />;
  }

  // Phase 2 gating: access is granted the moment the seat OR full fee is paid.
  const access = hasCourseAccess(course.id, { paidCourseIds });
  if (!access) {
    return (
      <Locked
        title="Class Hub is locked"
        subtitle={`Book your seat for "${course.title}" to unlock live classes, orientation videos and study material.`}
        cta={{ href: `/courses/${course.slug}/enroll`, label: "Enroll now" }}
      />
    );
  }

  const ar = course.after_registration || {};
  const [docs, learner] = await Promise.all([
    getLibraryDocsByIds([...(ar.doc_ids || []), ...(course.brochure_ids || [])]),
    resolveLearner(),
  ]);

  // Reuse the entitlement engine for limited-access expiry: if the learner's
  // valid course set no longer includes this course, the batch content is gated.
  const accessExpired = !!learner && !learner.courseIds.includes(course.id);
  const sections = accessExpired ? [] : await getClassHubSectionsForCourse(course.id, learner, courses);

  return (
    <div className="container-wide section space-y-6">
      <Link href="/portal" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink2 hover:text-primary">
        <ArrowLeft size={15} /> My portal
      </Link>

      <section className="ca-dark ca-grain relative overflow-hidden rounded-2xl p-6 sm:p-8">
        <div className="ca-orb" style={{ width: 220, height: 220, top: -110, right: -50, background: "rgba(212,175,55,0.18)" }} />
        <div className="relative">
          <p className="ca-eyebrow">Class Hub</p>
          <h1 className="ca-hero-title mt-2 font-heading text-2xl font-extrabold leading-tight sm:text-3xl">{course.title}</h1>
          <p className="mt-3 max-w-2xl text-[var(--ca-slate-300)]">Everything you need for this batch — live classes, recordings, notes, tests and current affairs.</p>
        </div>
      </section>

      <ClassHubContent course={course} docs={docs} />

      {accessExpired ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="font-heading text-lg font-bold text-amber-900">Your access to this batch has ended</p>
          <p className="mt-1 text-sm text-amber-800">Renew to regain recordings, notes, tests and current affairs. Your progress is saved.</p>
        </div>
      ) : (
        <ClassHubBatch courseId={course.id} sections={sections} />
      )}
    </div>
  );
}

function Locked({ title, subtitle, cta }: { title: string; subtitle: string; cta?: { href: string; label: string } }) {
  return (
    <div className="container-wide section">
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-surface2 text-ink2"><Lock size={24} /></div>
        <h1 className="mt-4 font-heading text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-ink2">{subtitle}</p>
        {cta && <Link href={cta.href} className="btn btn-primary mt-5 text-sm">{cta.label}</Link>}
      </div>
    </div>
  );
}
