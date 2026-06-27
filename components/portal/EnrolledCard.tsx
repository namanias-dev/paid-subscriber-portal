"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Calendar, Clock, User, ArrowRight, Video, GraduationCap, Package } from "lucide-react";
import { formatISTDateTime } from "@/lib/dates";

type Variant = "webinar" | "course" | "generic";
type Tone = "gold" | "green" | "blue" | "amber" | "gray";

export interface EnrolledCardProps {
  variant: Variant;
  title: string;
  href: string;
  cta?: string | null;
  image?: string | null;
  description?: string | null;
  /** Secondary meta line for course/generic (e.g. batch / faculty / duration). */
  metaLine?: string | null;
  // --- Webinar timing (all optional) ---
  datetime?: string | null;
  endDatetime?: string | null;
  adminStatus?: "upcoming" | "live" | "completed" | null;
  /** Server clock at render time — keeps the first client paint hydration-stable. */
  serverNow?: number;
  // --- Course progress (optional) ---
  progressPct?: number | null;
  progressNote?: ReactNode;
  /** Small line rendered under the progress bar (e.g. remaining / overdue). */
  progressFootnote?: ReactNode;
  // --- Decoration ---
  cornerBadge?: { label: string; tone?: Tone } | null;
  newCount?: number | null;
  /** Extra content rendered under the CTA (e.g. the "View N enrollments" expander). */
  footerSlot?: ReactNode;
  index?: number;
}

const TONE_CLS: Record<Tone, string> = {
  gold: "bg-[rgba(212,175,55,0.95)] text-[#1a1304]",
  green: "bg-[#16a34a] text-white",
  blue: "bg-[#2563eb] text-white",
  amber: "bg-[#d97706] text-white",
  gray: "bg-white/90 text-[var(--ca-navy-900)]",
};

const ICON: Record<Variant, typeof Video> = {
  webinar: Video,
  course: GraduationCap,
  generic: Package,
};

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "Starting now";
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `Starts in ${d}d ${h}h`;
  if (h > 0) return `Starts in ${h}h ${m}m`;
  if (m > 1) return `Starts in ${m}m`;
  return "Starts soon";
}

/**
 * Shared premium "enrolled item" card (webinar / course / generic purchase).
 * Display-only: it just presents data passed by the portal page — no gating,
 * entitlement or query logic lives here. Cover image renders via next/image with
 * a graceful gradient fallback (and onError fallback), so a missing/slow/broken
 * image never breaks layout. Hover/zoom are CSS; mount fade uses framer-motion.
 * prefers-reduced-motion disables both.
 */
export default function EnrolledCard(props: EnrolledCardProps) {
  const {
    variant, title, href, image, description, metaLine,
    datetime, endDatetime, adminStatus, serverNow,
    progressPct, progressNote, progressFootnote, cornerBadge, newCount, footerSlot, index = 0,
  } = props;

  const reduce = useReducedMotion();
  const [now, setNow] = useState<number>(serverNow ?? Date.now());
  const [imgOk, setImgOk] = useState(true);

  useEffect(() => {
    if (variant !== "webinar" || !datetime) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [variant, datetime]);

  const startMs = datetime ? new Date(datetime).getTime() : null;
  const endMs = endDatetime ? new Date(endDatetime).getTime() : (startMs != null ? startMs + 2 * 3600 * 1000 : null);

  let phase: "live" | "upcoming" | "completed" | null = null;
  if (variant === "webinar") {
    if (adminStatus === "completed") phase = "completed";
    else if (adminStatus === "live") phase = "live";
    else if (startMs == null) phase = "upcoming";
    else if (now >= startMs && (endMs == null || now <= endMs)) phase = "live";
    else if (endMs != null && now > endMs) phase = "completed";
    else phase = "upcoming";
  }
  const near = phase === "upcoming" && startMs != null && startMs - now <= 30 * 60000;

  const statusPill =
    phase === "live" ? { label: "Live now", live: true, tone: "green" as Tone }
    : phase === "completed" ? { label: "Recording", live: false, tone: "gray" as Tone }
    : phase === "upcoming" ? { label: "Upcoming", live: false, tone: "green" as Tone }
    : null;

  const ctaLabel = cta(props, phase, near);
  const Icon = ICON[variant];
  const showImg = !!image && imgOk;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.2), ease: [0.22, 1, 0.36, 1] }}
      className="ca-focus group block h-full"
    >
      <article className="relative h-full rounded-2xl bg-gradient-to-b from-white/70 via-[var(--ca-slate-200)] to-[rgba(212,175,55,0.45)] p-px shadow-[0_1px_2px_rgba(10,26,63,0.05),0_18px_40px_-26px_rgba(10,26,63,0.30)] transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_1px_2px_rgba(10,26,63,0.06),0_30px_60px_-24px_rgba(212,175,55,0.42)] motion-reduce:transform-none motion-reduce:transition-none">
        <div className="relative flex h-full flex-col overflow-hidden rounded-[15px] bg-white before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-white/70">
          {/* Cover hero */}
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)]">
            {showImg ? (
              <Image
                src={image!}
                alt={title}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                loading="lazy"
                onError={() => setImgOk(false)}
                className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transform-none"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-5 text-center">
                <Icon size={30} strokeWidth={1.5} className="text-[var(--ca-gold-bright)] opacity-90" aria-hidden="true" />
                <p className="line-clamp-2 font-heading text-sm font-bold text-white/90">{title}</p>
              </div>
            )}

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/10" aria-hidden="true" />

            <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
              {statusPill ? (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold shadow-sm backdrop-blur-sm ${statusPill.live ? "bg-[#dc2626] text-white" : TONE_CLS[statusPill.tone]}`}>
                  {statusPill.live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />}
                  {statusPill.label}
                </span>
              ) : <span />}
              {cornerBadge && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold shadow-sm backdrop-blur-sm ${TONE_CLS[cornerBadge.tone || "gold"]}`}>
                  {cornerBadge.label}
                </span>
              )}
            </div>

            {newCount ? (
              <span className="absolute bottom-3 left-3 inline-flex items-center rounded-full bg-gradient-to-r from-[var(--ca-gold-bright)] to-[var(--ca-gold)] px-2 py-0.5 text-[10px] font-extrabold text-[#1a1304] shadow">
                {newCount} new
              </span>
            ) : null}
          </div>

          {/* Content */}
          <div className="flex flex-1 flex-col p-5">
            <h3 className="line-clamp-2 font-heading text-base font-bold leading-snug tracking-tight text-[var(--ca-navy-900)]">{title}</h3>
            {description && <p className="mt-1.5 line-clamp-1 text-sm text-[var(--ca-slate-700)]">{description}</p>}

            {variant === "webinar" && datetime && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--ca-slate-400)]">
                <span className="inline-flex items-center gap-1.5"><Calendar size={14} aria-hidden="true" /> {formatISTDateTime(datetime)}</span>
                {phase === "upcoming" && startMs != null && (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#16a34a]"><Clock size={14} aria-hidden="true" /> {fmtCountdown(startMs - now)}</span>
                )}
              </div>
            )}

            {variant !== "webinar" && metaLine && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--ca-slate-400)]">
                <span className="inline-flex items-center gap-1.5"><User size={14} aria-hidden="true" /> {metaLine}</span>
              </div>
            )}

            {variant === "course" && typeof progressPct === "number" ? (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-xs">
                  {progressNote ? <span className="font-semibold text-ink">{progressNote}</span> : <span />}
                  <span className="text-muted">{Math.round(progressPct)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface2">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }} />
                </div>
                {progressFootnote && <div className="mt-2 text-xs text-ink2">{progressFootnote}</div>}
              </div>
            ) : variant === "course" && progressNote ? (
              <p className="mt-3 text-xs text-ink2">{progressNote}</p>
            ) : null}

            <div className="mt-auto pt-4">
              <Link href={href} className="ca-btn ca-btn-gold ca-focus w-full justify-center text-sm">
                {ctaLabel} <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
              </Link>
              {footerSlot}
            </div>
          </div>
        </div>
      </article>
    </motion.div>
  );
}

function cta(props: EnrolledCardProps, phase: string | null, near: boolean): string {
  if (props.cta) return props.cta;
  if (props.variant === "webinar") {
    if (phase === "live" || near) return "Join webinar";
    if (phase === "completed") return "Watch recording";
    return "View details";
  }
  if (props.variant === "course") return "Open course";
  return "Open content";
}
