import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Lock } from "lucide-react";
import { getBuyerSession } from "@/lib/session";
import { getAllCourses, getLibraryDocsByIds, paidCourseIdsForPhone, getOrientationVideosForTarget, getCourseEnrollmentsByPhone, getAccessOverridesByPhone } from "@/lib/dataProvider";
import { hasCourseAccess } from "@/lib/courseAccess";
import { resolveLearner } from "@/lib/entitlements";
import { computeCoursePlaybackAccess } from "@/lib/coursePlaybackAccess";
import { nextUnpaidDatedLine } from "@/lib/accessAtRisk";
import { getClassHubSectionsForCourse, getClassHubPerformance } from "@/lib/classHubServer";
import { buildPerformanceData } from "@/lib/performance";
import { resolveEnrollmentBatchId, resolveLiveClass } from "@/lib/courseZoom";
import ClassHubContent from "@/components/dashboard/ClassHubContent";
import ClassHubBatch from "@/components/dashboard/ClassHubBatch";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Class Hub", robots: { index: false, follow: false } };

export default async function PortalClassHubPage({
  params,
  searchParams,
}: {
  params: { courseId: string };
  searchParams?: { tab?: string };
}) {
  const session = await getBuyerSession();
  if (!session) redirect(`/portal/login?next=${encodeURIComponent(`/portal/class/${params.courseId}`)}`);

  const [courses, paidCourseIds, courseEnrollments, overrides] = await Promise.all([
    getAllCourses(),
    paidCourseIdsForPhone(session.phone),
    getCourseEnrollmentsByPhone(session.phone),
    getAccessOverridesByPhone(session.phone),
  ]);
  const course = courses.find((c) => c.id === params.courseId);

  if (!course) {
    return <Locked title="Course not found" subtitle="This course is no longer available." />;
  }

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

  const enrollment = courseEnrollments.find((e) => e.course_id === course.id && e.status !== "cancelled") || null;
  const override = overrides.find((o) => o.course_id === course.id);
  // SoT — same lectureAccessForCourse path as the pinned access bar.
  const playback = computeCoursePlaybackAccess(course, enrollment || undefined, override);
  const playbackLocked = !playback.allowed;
  const unpaid = enrollment ? nextUnpaidDatedLine(enrollment.schedule) : null;
  const lockPayHref = enrollment ? `/portal/course/${enrollment.id}` : "/portal";
  const lockInstallmentNo = unpaid?.no ?? null;

  const batchId = resolveEnrollmentBatchId(course, enrollment);
  const live = resolveLiveClass(course, batchId);
  // Strip Zoom credentials server-side when blocked — never ship href/meeting id to HTML.
  const liveSafe = playbackLocked
    ? { ...live, zoom_link: null, zoom_meeting_id: null, zoom_passcode: null, zoom_note: null }
    : live;

  const ar = course.after_registration || {};
  const [docs, orientationVideos, learner] = await Promise.all([
    getLibraryDocsByIds([...(ar.doc_ids || []), ...(course.brochure_ids || [])]),
    getOrientationVideosForTarget("course", course.id, { publishedOnly: true }),
    resolveLearner(),
  ]);

  // When playback locked, do not pass downloadable file URLs into the client tree.
  const docsSafe = playbackLocked
    ? docs.map((d) => ({ ...d, file_url: "" }))
    : docs;

  const accessExpired = !!learner && !learner.courseIds.includes(course.id);
  const [sections, performance] = accessExpired
    ? [[], buildPerformanceData({ attempts: [], quizById: new Map(), available: [], attemptStatus: {}, views: [], courseId: course.id })]
    : await Promise.all([
        getClassHubSectionsForCourse(course.id, learner),
        getClassHubPerformance(course.id, learner, courses),
      ]);

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

      <ClassHubContent
        course={course}
        docs={docsSafe}
        orientationVideos={playbackLocked ? [] : orientationVideos}
        live={liveSafe}
        playbackLocked={playbackLocked}
        lockPayHref={lockPayHref}
        lockInstallmentNo={lockInstallmentNo}
      />

      {accessExpired ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="font-heading text-lg font-bold text-amber-900">Your access to this batch has ended</p>
          <p className="mt-1 text-sm text-amber-800">Renew to regain recordings, notes, tests and current affairs. Your progress is saved.</p>
        </div>
      ) : (
        <ClassHubBatch
          courseId={course.id}
          sections={sections}
          performance={performance}
          initialTab={searchParams?.tab}
          playbackLocked={playbackLocked}
          lockPayHref={lockPayHref}
          lockInstallmentNo={lockInstallmentNo}
        />
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
