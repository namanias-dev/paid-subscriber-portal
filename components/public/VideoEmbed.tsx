import type { LandingVideo } from "@/lib/landingView";

/**
 * Lazy 16:9 YouTube iframe, or a lightweight clickable card for Instagram
 * reels (avoids loading Instagram's heavy embed scripts on the public page).
 */
export default function VideoEmbed({ video }: { video?: LandingVideo | null }) {
  if (!video) return null;
  const title = video.title?.trim();
  const subtitle = video.subtitle?.trim();

  return (
    <section className="mt-10">
      {title && <h2 className="text-2xl font-extrabold">{title}</h2>}
      {subtitle && <p className="mt-1 text-ink2">{subtitle}</p>}
      <div className={title || subtitle ? "mt-4" : ""}>
        {video.kind === "youtube" && video.embedUrl ? (
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-soft">
            <iframe
              src={video.embedUrl}
              title={title || "Video"}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="absolute inset-0 h-full w-full"
            />
          </div>
        ) : (
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            className="card card-hover flex items-center gap-4 p-5"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-tint text-2xl">▶</span>
            <span>
              <span className="block font-semibold text-ink">Watch on Instagram</span>
              <span className="block text-sm text-ink2">Tap to open the reel in a new tab</span>
            </span>
          </a>
        )}
      </div>
    </section>
  );
}
