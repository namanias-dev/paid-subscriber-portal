import Link from "next/link";
import Image from "next/image";
import { GraduationCap, ArrowRight, Layers, Clock, CalendarDays, User, CalendarClock, CheckCircle2 } from "lucide-react";
import { formatINR, formatISTDate } from "@/lib/dates";
import type { Course } from "@/lib/types";
import type { CoursePurchaseView } from "@/lib/purchaseStatus";

export function discountPct(price: number, original: number | null): number | null {
  if (!original || original <= price) return null;
  return Math.round(((original - price) / original) * 100);
}

/** Premium course list card: cover image, glass depth, gold accents, clear price. */
export default function CourseCard({ course, purchase }: { course: Course; purchase?: CoursePurchaseView | null }) {
  const cover = course.cover_image_url || course.image || course.mobile_image_url || null;
  const off = discountPct(course.price, course.original_price);
  const category = course.badge_label?.trim() || course.category;
  const cta = course.price === 0 ? "Start free" : "View course";
  // When the logged-in buyer already owns this course, the whole card becomes a
  // shortcut into the portal (no nested links) and shows their status, not a price.
  const href = purchase ? purchase.href : `/courses/${course.slug}`;

  // --- Batch-aware card (display only). A course with 2+ batches summarises ALL
  // of them (combined timings/modes, shared-or-"multiple" start, "From" price) so
  // the card no longer reflects just the default batch. With 0/1 batch every value
  // falls back to the course-level fields, so single-batch cards are byte-for-byte
  // unchanged. The per-batch choice still lives on the enroll-page selector. ---
  const batches = course.batches || [];
  const multiBatch = batches.length >= 2;

  const modeList = multiBatch
    ? Array.from(new Set(batches.flatMap((b) => b.mode || []).filter(Boolean)))
    : course.modes || [];
  const modes = modeList.length ? modeList.join(" · ") : null;

  let batchLine: string;
  if (multiBatch) {
    const timings = Array.from(new Set(batches.flatMap((b) => b.timing || []).filter(Boolean)));
    const starts = Array.from(new Set(batches.map((b) => b.start_date).filter((s): s is string => !!s)));
    const timingPart = timings.length
      ? `${timings.join(" & ")} ${timings.length > 1 ? "batches" : "batch"}`
      : `${batches.length} batches`;
    const datePart = starts.length === 1 ? `Starts ${formatISTDate(starts[0])}` : starts.length > 1 ? "Multiple start dates" : null;
    batchLine = [timingPart, datePart].filter(Boolean).join(" · ");
  } else {
    const timing = (course.batch_timings || []).filter(Boolean)[0];
    batchLine = [timing ? `${timing} batch` : null, course.batch_start ? `Starts ${formatISTDate(course.batch_start)}` : null]
      .filter(Boolean)
      .join(" · ");
  }

  // "From <lowest batch price>" only when batches actually differ in price; if every
  // batch costs the same we keep the single price (and the usual strikethrough).
  const batchPrices = multiBatch ? batches.map((b) => b.price).filter((n): n is number => typeof n === "number") : [];
  const priceVaries = batchPrices.length > 1 && new Set(batchPrices).size > 1;
  const displayPrice = priceVaries ? Math.min(...batchPrices) : course.price;

  return (
    <Link href={href} className="ca-focus group block h-full">
      <article className="relative h-full rounded-2xl bg-gradient-to-b from-white/70 via-[var(--ca-slate-200)] to-[rgba(212,175,55,0.45)] p-px shadow-[0_1px_2px_rgba(10,26,63,0.05),0_18px_40px_-26px_rgba(10,26,63,0.30)] transition-all duration-200 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_1px_2px_rgba(10,26,63,0.06),0_30px_60px_-24px_rgba(212,175,55,0.42)] motion-reduce:transform-none motion-reduce:transition-none">
        <div className="relative flex h-full flex-col overflow-hidden rounded-[15px] bg-white before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-white/70">
          {/* Cover image */}
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)]">
            {cover ? (
              <Image
                src={cover}
                alt={course.title}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transform-none"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-5 text-center">
                <GraduationCap size={30} strokeWidth={1.5} className="text-[var(--ca-gold-bright)] opacity-90" aria-hidden="true" />
                <p className="line-clamp-2 font-heading text-sm font-bold text-white/90">{course.title}</p>
              </div>
            )}

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/10" aria-hidden="true" />

            <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
              <span className="inline-flex items-center rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-[var(--ca-navy-900)] shadow-sm backdrop-blur-sm">
                {category}
              </span>
              {purchase ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#16a34a] px-2.5 py-1 text-[11px] font-extrabold text-white shadow-sm backdrop-blur-sm">
                  <CheckCircle2 size={12} /> {purchase.label}
                </span>
              ) : off ? (
                <span className="inline-flex items-center rounded-full bg-[rgba(212,175,55,0.95)] px-2.5 py-1 text-[11px] font-extrabold text-[#1a1304] shadow-sm backdrop-blur-sm">
                  {off}% OFF
                </span>
              ) : course.price === 0 ? (
                <span className="inline-flex items-center rounded-full bg-[#16a34a] px-2.5 py-1 text-[11px] font-extrabold text-white shadow-sm backdrop-blur-sm">
                  Free
                </span>
              ) : null}
            </div>
          </div>

          {/* Content */}
          <div className="flex flex-1 flex-col p-5">
            <h3 className="line-clamp-2 font-heading text-lg font-bold leading-snug tracking-tight text-[var(--ca-navy-900)]">{course.title}</h3>
            {course.description && <p className="mt-1.5 line-clamp-1 text-sm text-[var(--ca-slate-700)]">{course.description}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--ca-slate-400)]">
              {modes && <span className="inline-flex items-center gap-1.5"><Layers size={14} aria-hidden="true" /> {modes}</span>}
              {course.duration && <span className="inline-flex items-center gap-1.5"><Clock size={14} aria-hidden="true" /> {course.duration}</span>}
              {!course.duration && course.target_years && <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} aria-hidden="true" /> {course.target_years}</span>}
              {course.faculty && <span className="inline-flex items-center gap-1.5"><User size={14} aria-hidden="true" /> {course.faculty}</span>}
            </div>

            {batchLine && (
              <p className="mt-2.5 inline-flex items-center gap-1.5 self-start rounded-full bg-[rgba(212,175,55,0.12)] px-2.5 py-1 text-xs font-semibold text-[#8a6d12]">
                <CalendarClock size={13} aria-hidden="true" /> {batchLine}
              </p>
            )}

            {purchase ? (
              <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#16a34a]">
                  <CheckCircle2 size={16} aria-hidden="true" /> {purchase.remaining > 0 ? `Balance ${formatINR(purchase.remaining)}` : "Full access"}
                </span>
                <span className="ca-btn ca-btn-gold ca-focus shrink-0 px-3.5 py-2 text-sm">
                  {purchase.cta} <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
                </span>
              </div>
            ) : (
              <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                <div className="min-w-0">
                  {course.price === 0 ? (
                    <span className="font-heading text-2xl font-extrabold text-[#16a34a]">Free</span>
                  ) : (
                    <div className="flex items-baseline gap-2">
                      {priceVaries && <span className="text-xs font-semibold text-[var(--ca-slate-400)]">From</span>}
                      <span className="font-heading text-2xl font-extrabold text-[var(--ca-navy-900)]">{formatINR(displayPrice)}</span>
                      {!priceVaries && course.original_price && course.original_price > course.price && (
                        <span className="text-sm text-[var(--ca-slate-400)] line-through">{formatINR(course.original_price)}</span>
                      )}
                    </div>
                  )}
                </div>
                <span className="ca-btn ca-btn-gold ca-focus shrink-0 px-3.5 py-2 text-sm">
                  {cta} <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
                </span>
              </div>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}
