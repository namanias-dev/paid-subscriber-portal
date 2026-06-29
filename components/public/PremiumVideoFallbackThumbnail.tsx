import { Play } from "lucide-react";

/**
 * Branded fallback thumbnail for a video that has no real thumbnail (no uploaded
 * image, not a YouTube source). Navy/gold gradient with academy branding, the
 * subject + lecture title and a clean play icon — so a card is never a blank
 * dark rectangle. Pure presentational; fills its parent (use inside aspect-video).
 */
export default function PremiumVideoFallbackThumbnail({
  title,
  subject,
  kindLabel,
}: {
  title: string;
  subject?: string | null;
  kindLabel?: string | null;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0b1437]">
      {/* gradient + soft gold glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0b1437] via-[#16245c] to-[#1c2d6b]" />
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.35),transparent_70%)]" />
      <div className="absolute -bottom-12 -left-8 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.18),transparent_70%)]" />

      <div className="relative flex h-full w-full flex-col justify-between p-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ca-gold)]">
          Naman IAS Academy
        </span>

        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--ca-gold)]/15 ring-1 ring-[var(--ca-gold)]/40 backdrop-blur-sm">
          <Play size={20} className="ml-0.5 fill-[var(--ca-gold)] text-[var(--ca-gold)]" />
        </span>

        <div className="min-w-0">
          {subject && (
            <span className="mb-1 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/85">
              {subject}
            </span>
          )}
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-white/95">{title}</p>
          {kindLabel && <p className="mt-0.5 text-[11px] text-white/60">{kindLabel}</p>}
        </div>
      </div>
    </div>
  );
}
