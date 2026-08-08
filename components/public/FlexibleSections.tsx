import Image from "next/image";
import RichContent from "./RichContent";
import VideoEmbed from "./VideoEmbed";
import { parseVideo } from "@/lib/videoEmbed";
import type { LandingSection } from "@/lib/landingView";
import { toPublicImageSrc } from "@/lib/publicMediaUrl";

export default function FlexibleSections({ sections }: { sections?: LandingSection[] }) {
  const list = (sections || []).filter((s) => s?.title?.trim());
  if (!list.length) return null;
  return (
    <>
      {list.map((s, i) => {
        const parsed = s.video_url?.trim() ? parseVideo(s.video_url) : null;
        const img = toPublicImageSrc(s.image_url);
        return (
          <section key={s.id || i} className="mt-10">
            <h2 className="text-2xl font-extrabold">{s.title}</h2>
            {s.subtitle?.trim() && <p className="mt-1 text-ink2">{s.subtitle}</p>}
            {img && (
              <div className="relative mt-4 aspect-[16/9] w-full overflow-hidden rounded-2xl bg-surface2">
                <Image src={img} alt={s.title} fill sizes="(max-width: 1024px) 100vw, 66vw" className="object-cover" />
              </div>
            )}
            {s.contentHtml && <RichContent html={s.contentHtml} className="mt-4" />}
            {parsed && parsed.kind !== "unknown" && (
              <VideoEmbed video={{ ...parsed, placement: "after_about", title: null, subtitle: null }} />
            )}
          </section>
        );
      })}
    </>
  );
}
