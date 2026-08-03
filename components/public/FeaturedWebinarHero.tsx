import Link from "next/link";
import Image from "next/image";
import { Calendar, Clock, ArrowRight } from "lucide-react";
import SeatCounter from "./SeatCounter";
import { formatINR, formatISTDateTime } from "@/lib/dates";
import { webinarRegCountDisplay, WEBINAR_REGCOUNT_ENCOURAGE } from "@/lib/webinarLifecycle";
import type { Webinar } from "@/lib/types";

/**
 * Above-the-fold hero card for the next live webinar on /webinars.
 * Sized so title + CTA fit a 360×640 viewport under the site header.
 * Single CTA → detail page. No inline checkout here.
 */
export default function FeaturedWebinarHero({
  webinar: w,
  registered = false,
  registeredCount = 0,
}: {
  webinar: Webinar;
  registered?: boolean;
  registeredCount?: number;
}) {
  const cover = w.cover_image_url || w.mobile_image_url || null;
  const priceLabel = w.price === 0 ? "Free" : formatINR(w.price);
  const seat = w.seat_config?.show ? w.seat_config : null;
  const regDisplay = webinarRegCountDisplay({
    count: registeredCount,
    showToggle: w.show_registration_count,
    completed: w.status === "completed",
  });
  const cta = registered
    ? w.status === "completed"
      ? "Watch recording →"
      : "View your registration →"
    : w.price === 0
      ? "Register free →"
      : `Pay ${priceLabel} & Reserve Seat →`;

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--ca-slate-200)] bg-white shadow-soft">
      <div className="relative aspect-[2/1] w-full overflow-hidden bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)] sm:aspect-[21/9]">
        {cover ? (
          <Image
            src={cover}
            alt={w.title}
            fill
            priority
            sizes="100vw"
            className="object-cover object-top"
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-black/10" aria-hidden="true" />
        <div className="absolute inset-x-2.5 top-2.5 flex flex-wrap items-start gap-1.5 sm:inset-x-4 sm:top-3 sm:gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#16a34a] px-2 py-0.5 text-[10px] font-extrabold text-white shadow-sm sm:px-2.5 sm:py-1 sm:text-[11px]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />
            Live Webinar
          </span>
          <span className="inline-flex items-center rounded-full bg-[rgba(212,175,55,0.95)] px-2 py-0.5 text-[10px] font-extrabold text-[#1a1304] shadow-sm sm:px-2.5 sm:py-1 sm:text-[11px]">
            {priceLabel}
          </span>
        </div>
      </div>

      <div className="p-3 sm:p-5">
        <h2 className="line-clamp-2 font-heading text-base font-extrabold leading-snug tracking-tight text-[var(--ca-navy-900)] sm:text-2xl">
          {w.title}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ca-slate-700)] sm:mt-2.5 sm:gap-x-4 sm:text-sm">
          <span className="inline-flex items-center gap-1">
            <Calendar size={13} aria-hidden="true" /> {formatISTDateTime(w.datetime)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={13} aria-hidden="true" /> Live + recording
          </span>
        </div>
        {regDisplay.mode === "count" ? (
          <p className="mt-1 text-xs font-semibold text-[var(--ca-navy-700)] sm:mt-2 sm:text-sm">
            {regDisplay.count.toLocaleString("en-IN")} registered — seats filling
          </p>
        ) : regDisplay.mode === "encourage" ? (
          <p className="mt-1 text-xs font-semibold text-[var(--ca-navy-700)] sm:mt-2 sm:text-sm">{WEBINAR_REGCOUNT_ENCOURAGE}</p>
        ) : null}
        {seat && (
          <div className="mt-1 sm:mt-2">
            <SeatCounter seat={seat} compact />
          </div>
        )}
        <Link
          href={`/webinars/${w.slug}`}
          className="ca-btn ca-btn-gold ca-focus mt-2.5 flex w-full items-center justify-center gap-2 py-2.5 text-sm font-bold sm:mt-4 sm:py-3 sm:text-base"
        >
          {cta} <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
