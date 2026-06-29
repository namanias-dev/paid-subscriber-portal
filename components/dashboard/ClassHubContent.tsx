import { Video, FileText, Clock } from "lucide-react";
import { formatISTDateTime } from "@/lib/dates";
import RichContent from "@/components/public/RichContent";
import BrochureCards from "@/components/public/BrochureCards";
import BatchCountdown from "@/components/public/BatchCountdown";
import OrientationVideoGrid from "@/components/public/OrientationVideoGrid";
import type { Course, LibraryDoc, AssignedOrientationVideo } from "@/lib/types";

/**
 * Shared Class Hub body (welcome, live class, videos, materials, blocks).
 * Used by both the student dashboard and the buyer portal Class Hub pages.
 *
 * `orientationVideos` are reusable library videos linked via content_orientation_
 * assignments; the legacy inline `after_registration.videos` are merged in (and
 * de-duplicated) for courses not yet migrated.
 */
export default function ClassHubContent({
  course,
  docs,
  orientationVideos = [],
}: {
  course: Course;
  docs: LibraryDoc[];
  orientationVideos?: AssignedOrientationVideo[];
}) {
  const ar = course.after_registration || {};
  const blocks = (ar.blocks || []).filter((b) => b.visible !== false && b.title?.trim());

  return (
    <>
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

      {/* Orientation / starter videos (reusable library links + legacy inline) */}
      <OrientationVideoGrid assigned={orientationVideos} inline={ar.videos || []} />

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
    </>
  );
}
