import { PlayCircle } from "lucide-react";
import { parseVideo } from "@/lib/videoEmbed";
import type { AssignedOrientationVideo, OrientationVideo } from "@/lib/types";

/**
 * Renders orientation / starter videos in a student's post-registration view
 * (course Class Hub + webinar portal). Source of truth is the reusable library
 * assignments (`assigned`); `inline` is the legacy per-course URL list, merged in
 * and de-duplicated so migrated courses never show a video twice.
 *
 * Access is gated by the CALLER (enrolled-student checks) — this is render-only.
 */

type View = {
  key: string;
  title?: string | null;
  description?: string | null;
  url?: string | null;        // youtube / drive link for inline embed or open
  lectureId?: string | null;  // hosted recording → /lecture/:id (own access rules)
};

function viewsFromAssigned(assigned: AssignedOrientationVideo[]): View[] {
  return assigned.map((a) => {
    const c = a.content;
    const isHosted = c.source_type === "hosted";
    return {
      key: `a-${a.assignment_id}`,
      title: c.title,
      description: c.description,
      url: isHosted ? null : c.youtube_link || c.drive_link || null,
      lectureId: isHosted ? c.id : null,
    };
  });
}

export default function OrientationVideoGrid({
  assigned,
  inline = [],
  heading = "Orientation & starter videos",
}: {
  assigned: AssignedOrientationVideo[];
  inline?: OrientationVideo[];
  heading?: string;
}) {
  const assignedViews = viewsFromAssigned(assigned);

  // De-dupe: skip any inline URL that's already represented by a linked library
  // video (covers the migration window before inline data is cleared).
  const assignedUrls = new Set(
    assigned
      .map((a) => (a.content.youtube_link || a.content.drive_link || "").trim())
      .filter(Boolean),
  );
  const inlineViews: View[] = (inline || [])
    .filter((v) => v.url?.trim() && !assignedUrls.has(v.url.trim()))
    .map((v, i) => ({ key: `i-${i}`, title: v.title, description: v.description, url: v.url }));

  const views = [...assignedViews, ...inlineViews];
  if (views.length === 0) return null;

  return (
    <section>
      <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
        <PlayCircle size={18} className="text-[var(--ca-gold)]" /> {heading}
      </h2>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        {views.map((v) => {
          const parsed = v.url ? parseVideo(v.url) : null;
          return (
            <div key={v.key} className="overflow-hidden rounded-2xl border border-line bg-surface">
              {v.lectureId ? (
                <a
                  href={`/lecture/${v.lectureId}`}
                  className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-surface2 text-sm font-semibold text-primary"
                >
                  <PlayCircle size={32} />
                  Watch recording →
                </a>
              ) : parsed?.kind === "youtube" && parsed.embedUrl ? (
                <div className="relative aspect-video w-full bg-black">
                  <iframe
                    src={parsed.embedUrl}
                    title={v.title || "Orientation video"}
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                    className="absolute inset-0 h-full w-full"
                  />
                </div>
              ) : v.url ? (
                <a href={v.url} target="_blank" rel="noopener noreferrer" className="flex aspect-video w-full items-center justify-center bg-surface2 text-sm text-primary">
                  Open video ↗
                </a>
              ) : null}
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
  );
}
