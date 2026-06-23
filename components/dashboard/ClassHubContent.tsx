import { Video, FileText, PlayCircle, Clock } from "lucide-react";
import { parseVideo } from "@/lib/videoEmbed";
import { formatISTDateTime } from "@/lib/dates";
import RichContent from "@/components/public/RichContent";
import BrochureCards from "@/components/public/BrochureCards";
import BatchCountdown from "@/components/public/BatchCountdown";
import type { Course, LibraryDoc } from "@/lib/types";

/**
 * Shared Class Hub body (welcome, live class, videos, materials, blocks).
 * Used by both the student dashboard and the buyer portal Class Hub pages.
 */
export default function ClassHubContent({ course, docs }: { course: Course; docs: LibraryDoc[] }) {
  const ar = course.after_registration || {};
  const videos = (ar.videos || []).filter((v) => v.url?.trim());
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
    </>
  );
}
