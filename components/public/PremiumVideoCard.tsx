"use client";

import { useState } from "react";
import Link from "next/link";
import { PlayCircle, Play, Lock, Sparkles, ExternalLink, CheckCircle2 } from "lucide-react";
import { parseVideo } from "@/lib/videoEmbed";
import { formatISTDate } from "@/lib/dates";
import PremiumVideoFallbackThumbnail from "./PremiumVideoFallbackThumbnail";

/**
 * One premium, consistent video card — shared by orientation/starter videos and
 * recording/lecture cards so they look identical.
 *
 * Thumbnail priority: uploaded/signed `thumbnailUrl` → derived YouTube thumbnail
 * → branded fallback (never a blank dark rectangle). Click behaviour:
 *   - hosted lecture  → Link to the signed-URL R2 player (`lectureHref`)
 *   - YouTube source  → inline click-to-play facade (loads the iframe on tap)
 *   - other external  → opens in a new tab (`externalUrl`)
 *   - locked / no access → not clickable; thumbnail shown, NO video URL.
 */

export interface PremiumVideoCardProps {
  title: string;
  kindLabel: string;
  subject?: string | null;
  description?: string | null;
  date?: string | null;
  durationSeconds?: number | null;
  durationText?: string | null;
  classNo?: number | null;
  thumbnailUrl?: string | null;
  youtubeUrl?: string | null;
  lectureHref?: string | null;
  externalUrl?: string | null;
  progressPct?: number;
  completed?: boolean;
  isNew?: boolean;
  locked?: boolean;
  unlockOn?: string | null;
  accessBlocked?: boolean;
  accessLabel?: string | null;
}

function fmtDuration(s?: number | null): string | null {
  if (!s || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

const SHELL =
  "group relative block h-full overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(212,175,55,0.5)] hover:shadow-soft motion-reduce:transform-none motion-reduce:transition-none";

export default function PremiumVideoCard(props: PremiumVideoCardProps) {
  const {
    title, kindLabel, subject, description, date, durationSeconds, durationText, classNo,
    thumbnailUrl, youtubeUrl, lectureHref, externalUrl, progressPct, completed, isNew,
    locked, unlockOn, accessBlocked, accessLabel,
  } = props;

  const [playing, setPlaying] = useState(false);

  const parsed = youtubeUrl ? parseVideo(youtubeUrl) : null;
  const ytId = parsed?.kind === "youtube" ? parsed.id ?? null : null;
  const ytEmbed = parsed?.kind === "youtube" ? parsed.embedUrl ?? null : null;
  const thumbSrc = thumbnailUrl || (ytId ? parsed?.thumbnail ?? null : null);

  const isLocked = !!locked || !!accessBlocked;
  const dur = durationText || fmtDuration(durationSeconds);

  const media = (
    <div className="relative aspect-video w-full">
      {playing && ytEmbed ? (
        <iframe
          src={`${ytEmbed}?autoplay=1`}
          title={title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <>
          {thumbSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbSrc} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <PremiumVideoFallbackThumbnail title={title} subject={subject} kindLabel={kindLabel} />
          )}

          {!isLocked && (
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-transform duration-200 group-hover:scale-110 group-hover:bg-[var(--ca-gold)] group-hover:text-[#1a1304] group-hover:shadow-[0_0_24px_rgba(212,175,55,0.7)]">
                <Play size={24} className="ml-0.5 fill-current" />
              </span>
            </span>
          )}

          {isLocked && (
            <span className="absolute inset-0 grid place-items-center bg-black/45 text-white">
              <Lock size={26} />
            </span>
          )}

          {dur && !playing && (
            <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">{dur}</span>
          )}
          {isNew && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[var(--ca-gold-bright)] to-[var(--ca-gold)] px-2 py-0.5 text-[10px] font-extrabold text-[#1a1304]">
              <Sparkles size={10} /> NEW
            </span>
          )}
          {completed && (
            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[10px] font-extrabold text-white">
              <CheckCircle2 size={11} /> Completed
            </span>
          )}
          {!!progressPct && progressPct > 0 && !completed && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
              <span className="block h-full bg-[var(--ca-gold)]" style={{ width: `${progressPct}%` }} />
            </span>
          )}
        </>
      )}
    </div>
  );

  const meta = (
    <div className="p-4">
      <p className="line-clamp-2 font-semibold leading-snug text-ink">
        {classNo != null && <span className="text-[var(--ca-gold)]">Class {classNo} · </span>}
        {title}
      </p>
      {description && <p className="mt-1 line-clamp-2 text-sm text-ink2">{description}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
        <span>{kindLabel}</span>
        {subject && <span>· {subject}</span>}
        {date && <span>· {formatISTDate(date)}</span>}
      </div>

      {locked ? (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
          <Lock size={12} /> Unlocks on {unlockOn ? formatISTDate(unlockOn) : "a later date"}
        </p>
      ) : accessBlocked ? (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
          <Lock size={12} /> {accessLabel || "Locked"}
        </p>
      ) : (
        <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
          {externalUrl && !ytId ? (
            <>Open <ExternalLink size={13} /></>
          ) : (
            <>
              {progressPct && progressPct > 0 ? "Continue watching" : "Watch recording"} <PlayCircle size={13} />
            </>
          )}
          {accessLabel && !accessBlocked && <span className="ml-1 text-xs font-normal text-muted">· {accessLabel}</span>}
        </span>
      )}
    </div>
  );

  // Non-clickable when locked / no access — thumbnail only, no video URL.
  if (isLocked) {
    return <div className={`${SHELL} opacity-95`}>{media}{meta}</div>;
  }
  // Hosted lecture → signed-URL player page.
  if (lectureHref) {
    return <Link href={lectureHref} className={`ca-focus ${SHELL}`}>{media}{meta}</Link>;
  }
  // YouTube → inline click-to-play facade.
  if (ytId) {
    if (playing) return <div className={SHELL}>{media}{meta}</div>;
    return (
      <button type="button" onClick={() => setPlaying(true)} className={`ca-focus w-full text-left ${SHELL}`} aria-label={`Play ${title}`}>
        {media}{meta}
      </button>
    );
  }
  // Other external link (Drive/Telegram).
  if (externalUrl) {
    return <a href={externalUrl} target="_blank" rel="noopener noreferrer" className={`ca-focus ${SHELL}`}>{media}{meta}</a>;
  }
  return <div className={SHELL}>{media}{meta}</div>;
}
