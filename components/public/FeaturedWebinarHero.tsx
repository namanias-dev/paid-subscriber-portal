import Link from "next/link";
import Image from "next/image";
import { Calendar, Clock, ArrowRight } from "lucide-react";
import SeatCounter from "./SeatCounter";
import { formatINR, formatISTDateTime } from "@/lib/dates";
import { webinarRegCountDisplay, WEBINAR_REGCOUNT_ENCOURAGE } from "@/lib/webinarLifecycle";
import type { Webinar } from "@/lib/types";

/**
 * Above-the-fold hero card for the next live webinar on /webinars.
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
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)] sm:aspect-[21/9]">
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
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/10" aria-hidden="true" />
        <div className="absolute inset-x-3 top-3 flex flex-wrap items-start gap-2 sm:inset-x-4 sm:top-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#16a34a] px-2.5 py-1 text-[11px] font-extrabold text-white shadow-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />
            Live Webinar
          </span>
          <span className="inline-flex items-center rounded-full bg-[rgba(212,175,55,0.95)] px-2.5 py-1 text-[11px] font-extrabold text-[#1a1304] shadow-sm">
            {priceLabel}
          </span>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <h2 className="font-heading text-xl font-extrabold leading-snug tracking-tight text-[var(--ca-navy-900)] sm:text-2xl">
          {w.title}
        </h2>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-[var(--ca-slate-700)]">
          <span className="inline-flex items-center gap-1.5">
            <Calendar size={15} aria-hidden="true" /> {formatISTDateTime(w.datetime)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={15} aria-hidden="true" /> Live + recording
          </span>
        </div>
        {regDisplay.mode === "count" ? (
          <p className="mt-2 text-sm font-semibold text-[var(--ca-navy-700)]">
            {regDisplay.count.toLocaleString("en-IN")} registered — seats filling
          </p>
        ) : regDisplay.mode === "encourage" ? (
          <p className="mt-2 text-sm font-semibold text-[var(--ca-navy-700)]">{WEBINAR_REGCOUNT_ENCOURAGE}</p>
        ) : null}
        {seat && (
          <div className="mt-2">
            <SeatCounter seat={seat} compact />
          </div>
        )}
        <Link
          href={`/webinars/${w.slug}`}
          className="ca-btn ca-btn-gold ca-focus mt-4 flex w-full items-center justify-center gap-2 text-base font-bold"
        >
          {cta} <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
