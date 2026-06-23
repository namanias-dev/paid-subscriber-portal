import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Video, Lock, FileText, PlayCircle, Clock } from "lucide-react";
import { getStudentSession } from "@/lib/session";
import { getEnrollments, getAllCourses, getLibraryDocsByIds } from "@/lib/dataProvider";
import { hasCourseAccess } from "@/lib/courseAccess";
import { parseVideo } from "@/lib/videoEmbed";
import { formatISTDateTime } from "@/lib/dates";
import RichContent from "@/components/public/RichContent";
import BrochureCards from "@/components/public/BrochureCards";
import BatchCountdown from "@/components/public/BatchCountdown";

export const dynamic = "force-dynamic";

export default async function ClassHubPage({ params }: { params: { courseId: string } }) {
  const session = await getStudentSession();
  if (!session) redirect("/login");

  const [enrollments, courses] = await Promise.all([getEnrollments(session.student_id), getAllCourses()]);
  const course = courses.find((c) => c.id === params.courseId);
  if (!course) {
    return <LockedOrMissing title="Course not found" subtitle="This course is no longer available." />;
  }

  // Phase 1 gating: active enrollment. Structured for Phase 2 (payment) via courseAccess.
  const access = hasCourseAccess(course.id, { enrollments });
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
  const videos = (ar.videos || []).filter((v) => v.url?.trim());
  const blocks = (ar.blocks || []).filter((b) => b.visible !== false && b.title?.trim());

  return (
    <div className="space-y-6">
      <Link href="/dashboard/my-courses" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink2 hover:text-primary">
        <ArrowLeft size={15} /> My Courses
      </Link>

      {/* Hero */}
      <section className="ca-dark ca-grain relative overflow-hidden rounded-2xl p-6 sm:p-8">
        <div className="ca-orb" style={{ width: 220, height: 220, top: -110, right: -50, background: "rgba(212,175,55,0.18)" }} />
        <div className="relative">
          <p className="ca-eyebrow">Class Hub</p>
          <h1 className="ca-hero-title mt-2 font-heading text-2xl font-extrabold leading-tight sm:text-3xl">{course.title}</h1>
          <p className="mt-3 max-w-2xl text-[var(--ca-slate-300)]">Everything you need for this batch — live classes, orientation videos and study material.</p>
        </div>
      </section>

      {/* Welcome message */}
      {ar.welcome_html && (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <RichContent html={ar.welcome_html} />
        </section>
      )}

      {/* Live class */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 font-heading text-lg font-bold"><Video size={18} className="text-[var(--ca-gold)]" /> Live class</h2>
          <p className="mt-1 text-sm text-ink2">
            {ar.class_timing ? <>Timing: <b className="text-ink">{ar.class_timing}</b> (IST)</> : "Join your scheduled live classes here."}
          </p>
          {ar.next_class_at && (
            <p className="mt-1 text-sm text-ink2"><Clock size={13} className="mr-1 inline" />Next class: {formatISTDateTime(ar.next_class_at)}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2.5">
            {ar.zoom_link ? (
              <a href={ar.zoom_link} target="_blank" rel="noopener noreferrer" className="ca-btn ca-btn-gold ca-focus">
                <Video size={16} /> Join Live Class on Zoom
              </a>
            ) : (
              <span className="text-sm text-muted">The join link will appear here before class begins.</span>
            )}
          </div>
          {ar.zoom_note && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              <span aria-hidden>📌</span> {ar.zoom_note}
            </p>
          )}
        </div>
        {ar.next_class_at && (
          <div>
            <BatchCountdown startISO={ar.next_class_at} label="Next live class in" liveLabel="Class in progress" />
          </div>
        )}
      </section>

      {/* Orientation videos */}
      {videos.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 font-heading text-lg font-bold"><PlayCircle size={18} className="text-[var(--ca-gold)]" /> Orientation &amp; starter videos</h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            {videos.map((v, i) => {
              const parsed = parseVideo(v.url);
              return (
                <div key={i} className="overflow-hidden rounded-2xl border border-line bg-surface">
                  {parsed?.kind === "youtube" && parsed.embedUrl ? (
                    <div className="relative aspect-video w-full bg-black">
                      <iframe
                        src={parsed.embedUrl}
                        title={v.title || `Video ${i + 1}`}
                        loading="lazy"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                        className="absolute inset-0 h-full w-full"
                      />
                    </div>
                  ) : (
                    <a href={v.url} target="_blank" rel="noopener noreferrer" className="flex aspect-video w-full items-center justify-center bg-surface2 text-sm text-primary">Open video ↗</a>
                  )}
                  {(v.title || v.description) && (
                    <div className="p-4">
                      {v.title && <p className="font-semibold">{v.title}</p>}
                      {v.description && <p className="mt-1 text-sm text-ink2">{v.description}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Study material / brochures */}
      {docs.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 font-heading text-lg font-bold"><FileText size={18} className="text-[var(--ca-gold)]" /> Study material &amp; downloads</h2>
          <div className="mt-4"><BrochureCards docs={docs} /></div>
        </section>
      )}

      {/* Flexible content blocks */}
      {blocks.length > 0 && (
        <section className="space-y-5">
          {blocks.map((b, i) => (
            <div key={b.id || i} className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="font-heading text-lg font-bold">{b.title}</h2>
              {b.subtitle && <p className="mt-1 text-sm text-ink2">{b.subtitle}</p>}
              {b.content && <RichContent html={b.content} className="mt-3" />}
            </div>
          ))}
        </section>
      )}
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
