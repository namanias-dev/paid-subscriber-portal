import { Video, FileText, Clock } from "lucide-react";
import { formatISTDateTime } from "@/lib/dates";
import RichContent from "@/components/public/RichContent";
import BrochureCards from "@/components/public/BrochureCards";
import BatchCountdown from "@/components/public/BatchCountdown";
import OrientationVideoGrid from "@/components/public/OrientationVideoGrid";
import { LockedAction, LockedCard } from "@/components/dashboard/ClassHubLocked";
import type { Course, LibraryDoc, AssignedOrientationVideo } from "@/lib/types";
import type { ResolvedLiveClass } from "@/lib/courseZoom";

/**
 * Shared Class Hub body (welcome, live class, videos, materials, blocks).
 * Used by both the student dashboard and the buyer portal Class Hub pages.
 *
 * `playbackLocked` MUST be derived from lectureAccessForCourse(..., override)
 * — the same SoT as the pinned access bar. Never recompute access here.
 */
export default function ClassHubContent({
  course,
  docs,
  orientationVideos = [],
  live,
  playbackLocked = false,
  lockPayHref = "/portal",
  lockInstallmentNo = null,
}: {
  course: Course;
  docs: LibraryDoc[];
  orientationVideos?: AssignedOrientationVideo[];
  live: ResolvedLiveClass;
  /** When true, Zoom / materials / orientation are locked (schedule stays visible). */
  playbackLocked?: boolean;
  lockPayHref?: string;
  lockInstallmentNo?: number | null;
}) {
  const ar = course.after_registration || {};
  const blocks = (ar.blocks || []).filter((b) => b.visible !== false && b.title?.trim());
  const timing = live.class_timing || ar.class_timing;
  const nextAt = live.next_class_at || ar.next_class_at;

  return (
    <>
      {ar.welcome_html && (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <RichContent html={ar.welcome_html} />
        </section>
      )}

      {/* Live class — schedule visible always; Zoom gated when playback locked */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 font-heading text-lg font-bold"><Video size={18} className="text-[var(--ca-gold)]" /> Live class</h2>
          <p className="mt-1 text-sm text-ink2">
            {timing ? <>Timing: <b className="text-ink">{timing}</b> (IST)</> : "Join your scheduled live classes here."}
          </p>
          {nextAt && (
            <p className="mt-1 text-sm text-ink2"><Clock size={13} className="mr-1 inline" />Next class: {formatISTDateTime(nextAt)}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2.5">
            {playbackLocked ? (
              <LockedAction
                label="Join Live Class on Zoom"
                installmentNo={lockInstallmentNo}
                payHref={lockPayHref}
              />
            ) : live.zoom_link ? (
              <a href={live.zoom_link} target="_blank" rel="noopener noreferrer" className="ca-btn ca-btn-gold ca-focus">
                <Video size={16} /> Join Live Class on Zoom
              </a>
            ) : (
              <span className="text-sm text-muted">The join link will appear here before class begins.</span>
            )}
          </div>
          {/* Meeting credentials are a Zoom leak when locked — hide entirely. */}
          {!playbackLocked && (live.zoom_meeting_id || live.zoom_passcode) && (
            <p className="mt-3 text-sm text-ink2">
              {live.zoom_meeting_id && <>Meeting ID: <b className="font-mono text-ink">{live.zoom_meeting_id}</b></>}
              {live.zoom_meeting_id && live.zoom_passcode && " · "}
              {live.zoom_passcode && <>Passcode: <b className="font-mono text-ink">{live.zoom_passcode}</b></>}
            </p>
          )}
          {!playbackLocked && live.zoom_note && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              <span aria-hidden>📌</span> {live.zoom_note}
            </p>
          )}
        </div>
        {nextAt && (
          <div>
            <BatchCountdown startISO={nextAt} label="Next live class in" liveLabel="Class in progress" />
          </div>
        )}
      </section>

      {/* Orientation / starter videos */}
      {playbackLocked ? (
        orientationVideos.length > 0 || (ar.videos || []).length > 0 ? (
          <section className="space-y-3">
            <h2 className="font-heading text-lg font-bold">Orientation</h2>
            <LockedCard installmentNo={lockInstallmentNo} payHref={lockPayHref} staggerIndex={0}>
              <div className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-muted">
                Orientation videos unlock when your instalment clears.
              </div>
            </LockedCard>
          </section>
        ) : null
      ) : (
        <OrientationVideoGrid assigned={orientationVideos} inline={ar.videos || []} />
      )}

      {/* Study material / brochures */}
      {docs.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 font-heading text-lg font-bold"><FileText size={18} className="text-[var(--ca-gold)]" /> Study material &amp; downloads</h2>
          <div className="mt-4">
            {playbackLocked ? (
              <LockedCard installmentNo={lockInstallmentNo} payHref={lockPayHref} staggerIndex={1}>
                <BrochureCards docs={docs} />
              </LockedCard>
            ) : (
              <BrochureCards docs={docs} />
            )}
          </div>
        </section>
      )}

      {/* Flexible content blocks — visible (not a content leak of paid media) */}
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
