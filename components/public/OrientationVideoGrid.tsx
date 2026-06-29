import { PlayCircle } from "lucide-react";
import { r2Configured, signGetUrl } from "@/lib/r2";
import PremiumVideoCard from "./PremiumVideoCard";
import type { AssignedOrientationVideo, OrientationVideo } from "@/lib/types";

/**
 * Renders orientation / starter videos in a student's post-registration view
 * (course Class Hub + webinar portal) using the shared PremiumVideoCard so they
 * look identical to recording cards. Source of truth is the reusable library
 * assignments (`assigned`); `inline` is the legacy per-course URL list, merged in
 * and de-duplicated so migrated courses never show a video twice.
 *
 * Access is gated by the CALLER (enrolled-student checks) — render-only. Hosted
 * orientation videos still open the signed-URL R2 player at /lecture/:id.
 */

type Card = {
  key: string;
  title: string;
  description?: string | null;
  kindLabel: string;
  subject?: string | null;
  date?: string | null;
  durationSeconds?: number | null;
  thumbnailUrl?: string | null;
  youtubeUrl?: string | null;
  lectureHref?: string | null;
  externalUrl?: string | null;
};

async function cardsFromAssigned(assigned: AssignedOrientationVideo[]): Promise<Card[]> {
  return Promise.all(
    assigned.map(async (a) => {
      const c = a.content;
      const isHosted = c.source_type === "hosted";
      const kindLabel = a.role === "starter" ? "Starter video" : "Orientation";
      let thumbnailUrl: string | null = null;
      if (isHosted && c.thumbnail_key && r2Configured()) {
        thumbnailUrl = await signGetUrl(c.thumbnail_key, 3600).catch(() => null);
      }
      return {
        key: `a-${a.assignment_id}`,
        title: c.title,
        description: c.description,
        kindLabel,
        subject: c.subject,
        date: c.date,
        durationSeconds: isHosted ? c.duration_seconds ?? null : null,
        thumbnailUrl,
        youtubeUrl: isHosted ? null : c.youtube_link || null,
        lectureHref: isHosted ? `/lecture/${c.id}` : null,
        externalUrl: isHosted ? null : c.youtube_link ? null : c.drive_link || null,
      };
    }),
  );
}

export default async function OrientationVideoGrid({
  assigned,
  inline = [],
  heading = "Orientation & starter videos",
}: {
  assigned: AssignedOrientationVideo[];
  inline?: OrientationVideo[];
  heading?: string;
}) {
  const assignedCards = await cardsFromAssigned(assigned);

  // De-dupe: skip any inline URL already represented by a linked library video.
  const assignedUrls = new Set(
    assigned.map((a) => (a.content.youtube_link || a.content.drive_link || "").trim()).filter(Boolean),
  );
  const inlineCards: Card[] = (inline || [])
    .filter((v) => v.url?.trim() && !assignedUrls.has(v.url.trim()))
    .map((v, i) => ({
      key: `i-${i}`,
      title: v.title || "Orientation video",
      description: v.description,
      kindLabel: "Orientation",
      youtubeUrl: v.url || null,
      externalUrl: v.url && !/youtu/i.test(v.url) ? v.url : null,
    }));

  const cards = [...assignedCards, ...inlineCards];
  if (cards.length === 0) return null;

  return (
    <section>
      <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
        <PlayCircle size={18} className="text-[var(--ca-gold)]" /> {heading}
      </h2>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        {cards.map((c) => (
          <PremiumVideoCard
            key={c.key}
            title={c.title}
            description={c.description}
            kindLabel={c.kindLabel}
            subject={c.subject}
            date={c.date}
            durationSeconds={c.durationSeconds}
            thumbnailUrl={c.thumbnailUrl}
            youtubeUrl={c.youtubeUrl}
            lectureHref={c.lectureHref}
            externalUrl={c.externalUrl}
          />
        ))}
      </div>
    </section>
  );
}
