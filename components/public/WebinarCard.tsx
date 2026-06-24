import Link from "next/link";
import Image from "next/image";
import { Calendar, Users, ArrowRight, Video, CheckCircle2 } from "lucide-react";
import SeatCounter from "./SeatCounter";
import { formatINR, formatISTDateTime } from "@/lib/dates";
import type { Webinar } from "@/lib/types";

function statusBadge(status: Webinar["status"], badgeLabel?: string | null) {
  if (badgeLabel?.trim()) return { label: badgeLabel.trim(), tone: "bg-white/90 text-[var(--ca-navy-900)]", live: false };
  switch (status) {
    case "live":
      return { label: "Live now", tone: "bg-[#dc2626] text-white", live: true };
    case "completed":
      return { label: "Recording", tone: "bg-white/85 text-[var(--ca-navy-900)]", live: false };
    default:
      return { label: "Upcoming", tone: "bg-[#16a34a] text-white", live: false };
  }
}

/** Premium webinar list card: cover image, glass depth, gold accents, IST meta. */
export default function WebinarCard({ webinar: w, registered = false }: { webinar: Webinar; registered?: boolean }) {
  const cover = w.cover_image_url || w.mobile_image_url || null;
  const badge = statusBadge(w.status, w.badge_label);
  const priceLabel = w.price === 0 ? "Free" : formatINR(w.price);
  const seat = w.seat_config?.show ? w.seat_config : null;
  const cta = registered
    ? (w.status === "completed" ? "Watch recording" : "View details")
    : w.status === "completed" ? "Watch recording" : w.price === 0 ? "Register free" : "View & register";

  return (
    <Link href={`/webinars/${w.slug}`} className="ca-focus group block h-full">
      <article className="relative h-full rounded-2xl bg-gradient-to-b from-white/70 via-[var(--ca-slate-200)] to-[rgba(212,175,55,0.45)] p-px shadow-[0_1px_2px_rgba(10,26,63,0.05),0_18px_40px_-26px_rgba(10,26,63,0.30)] transition-all duration-200 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_1px_2px_rgba(10,26,63,0.06),0_30px_60px_-24px_rgba(212,175,55,0.42)] motion-reduce:transform-none motion-reduce:transition-none">
        <div className="relative flex h-full flex-col overflow-hidden rounded-[15px] bg-white before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-white/70">
          {/* Cover image */}
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)]">
            {cover ? (
              <Image
                src={cover}
                alt={w.title}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transform-none"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-5 text-center">
                <Video size={30} strokeWidth={1.5} className="text-[var(--ca-gold-bright)] opacity-90" aria-hidden="true" />
                <p className="line-clamp-2 font-heading text-sm font-bold text-white/90">{w.title}</p>
              </div>
            )}

            {/* Bottom gradient for legibility */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/10" aria-hidden="true" />

            {/* Badges */}
            <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold shadow-sm backdrop-blur-sm ${badge.tone}`}>
                {badge.live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />}
                {badge.label}
              </span>
              {registered ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#16a34a] px-2.5 py-1 text-[11px] font-extrabold text-white shadow-sm backdrop-blur-sm">
                  <CheckCircle2 size={12} /> Registered
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-[rgba(212,175,55,0.95)] px-2.5 py-1 text-[11px] font-extrabold text-[#1a1304] shadow-sm backdrop-blur-sm">
                  {priceLabel}
                </span>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex flex-1 flex-col p-5">
            <h3 className="line-clamp-2 font-heading text-lg font-bold leading-snug tracking-tight text-[var(--ca-navy-900)]">{w.title}</h3>
            {w.description && <p className="mt-1.5 line-clamp-1 text-sm text-[var(--ca-slate-700)]">{w.description}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--ca-slate-400)]">
              <span className="inline-flex items-center gap-1.5"><Calendar size={14} aria-hidden="true" /> {formatISTDateTime(w.datetime)}</span>
              <span className="inline-flex items-center gap-1.5"><Users size={14} aria-hidden="true" /> {w.registrations.toLocaleString("en-IN")} registered</span>
            </div>

            {seat && <div className="mt-3"><SeatCounter seat={seat} compact /></div>}

            <div className="mt-auto pt-4">
              {registered && (
                <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#16a34a]">
                  <CheckCircle2 size={15} aria-hidden="true" /> You&apos;re registered
                </p>
              )}
              <span className="ca-btn ca-btn-gold ca-focus w-full justify-center text-sm">
                {cta} <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
              </span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
