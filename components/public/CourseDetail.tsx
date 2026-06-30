import Link from "next/link";
import Image from "next/image";
import {
  GraduationCap, Clock, CalendarDays, Languages, Video, ArrowRight,
  ShieldCheck, Headphones, CheckCircle2, XCircle, BookOpen, ChevronDown, CalendarClock,
} from "lucide-react";
import { formatINR } from "@/lib/dates";
import { resolveEmiConfig, payInFullTotal } from "@/lib/installments";
import { courseOfferingSummary } from "@/lib/courseView";
import { discountPct } from "@/components/public/CourseCard";
import CourseCard from "@/components/public/CourseCard";
import SeatCounter from "@/components/public/SeatCounter";
import WhatsAppButton from "@/components/public/WhatsAppButton";
import LandingSections from "@/components/public/LandingSections";
import BrochureCards from "@/components/public/BrochureCards";
import BatchCountdown from "@/components/public/BatchCountdown";
import type { Course, LibraryDoc } from "@/lib/types";
import type { LandingView } from "@/lib/landingView";
import type { CoursePurchaseView } from "@/lib/purchaseStatus";

const COURSE_FAQ = [
  { q: "Will I get recordings?", a: "Yes, recordings are available for all live sessions for the duration of your access." },
  { q: "Is there doubt support?", a: "Yes, doubts are addressed in dedicated sessions and via the community." },
  { q: "Can I pay in installments?", a: "Most programs support EMI. See the Fees & EMI section for details." },
];

export default function CourseDetail({ course, related, comparison, view, brochures = [], purchase = null }: { course: Course; related: Course[]; comparison: Course[]; view: LandingView; brochures?: LibraryDoc[]; purchase?: CoursePurchaseView | null }) {
  const off = discountPct(course.price, course.original_price);
  const emiCfg = resolveEmiConfig(course);
  const payInFull = payInFullTotal(course);
  const fullSavings = Math.max(0, course.price - payInFull);
  const emiLine = emiCfg.enabled && emiCfg.installmentCounts.length
    ? `EMI available — pay over up to ${Math.max(...emiCfg.installmentCounts)} months${emiCfg.seatAmount ? `, or book your seat from ${formatINR(emiCfg.seatAmount)}` : ""}.`
    : null;
  const faqs = (course.faqs || []).filter((f) => f.q?.trim());
  const faqItems = faqs.length ? faqs : COURSE_FAQ;
  // Batch-aware presentation (display-only), consistent with the listing card.
  // For 0/1-batch courses summary.multiBatch is false → every value below falls
  // back to the course-level fields, so single-batch detail pages are unchanged.
  const summary = courseOfferingSummary(course);
  const priceVaries = summary.priceVaries;
  const displayPrice = summary.displayPrice;
  const priceLabel = course.price === 0 ? "Free" : priceVaries ? `From ${formatINR(displayPrice)}` : formatINR(course.price);
  const cover = course.cover_image_url || course.image || course.mobile_image_url || null;
  const enrollHref = purchase ? purchase.href : course.price === 0 ? `/enroll/${course.slug}` : `/courses/${course.slug}/enroll`;
  const enrollLabel = purchase ? purchase.cta : course.price === 0 ? "Book Now" : "Enroll Now";
  const included = (course.included || []).filter(Boolean);
  const notIncluded = (course.not_included || []).filter(Boolean);
  const curriculum = (course.curriculum || []).filter((m) => m?.title?.trim());

  const timings = (course.batch_timings || []).filter(Boolean);
  // Multi-batch → union of timings/modes across ALL offerings; single-batch keeps
  // the exact course-level labels as before.
  const timingLabel = summary.multiBatch
    ? (summary.timings.length ? `${summary.timings.join(" & ")} ${summary.timings.length > 1 ? "batches" : "batch"}` : null)
    : (timings.length ? `${timings.join(" / ")} batch` : null);
  const modesLabel = summary.multiBatch
    ? (summary.modes.length ? summary.modes.join(" · ") : null)
    : (course.modes?.length ? course.modes.join(" · ") : null);
  const heroMode = summary.multiBatch ? (summary.modes.join(" · ") || null) : (course.modes?.[0] || null);
  // For a single shared start (or single-batch) keep the countdown; hide it when
  // batches genuinely start on different dates (the meta shows "Multiple start dates").
  const countdownStart = summary.multiBatch ? summary.sharedStart : (course.batch_start ?? null);
  const meta: { icon: typeof Clock; label: string }[] = [
    ...(course.duration ? [{ icon: Clock, label: course.duration }] : []),
    { icon: GraduationCap, label: course.faculty },
    { icon: CalendarDays, label: `Target ${course.target_years}` },
    ...(timingLabel ? [{ icon: CalendarClock, label: timingLabel }] : []),
    ...(summary.multiBatch && !summary.sharedStart && summary.starts.length > 1
      ? [{ icon: CalendarClock, label: "Multiple start dates" }]
      : []),
    ...(course.language ? [{ icon: Languages, label: course.language }] : []),
    ...(modesLabel ? [{ icon: Video, label: modesLabel }] : []),
  ];

  return (
    <div className="overflow-x-clip bg-[var(--ca-slate-50)]">
      <div className="container-wide pb-28 pt-6 sm:pt-8 lg:pb-16">
        <Link href="/courses" className="ca-focus inline-flex items-center gap-1 text-sm font-medium text-[var(--ca-navy-600)] hover:text-[var(--ca-gold)]">
          <ArrowRight size={15} className="rotate-180" /> All courses
        </Link>

        {/* Hero banner */}
        <section className="mt-4">
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)] sm:aspect-[21/9]">
            {cover ? (
              <Image src={cover} alt={course.title} fill priority sizes="(max-width: 1024px) 100vw, 1100px" className="object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
                <GraduationCap size={40} strokeWidth={1.5} className="text-[var(--ca-gold-bright)] opacity-90" aria-hidden="true" />
                <p className="font-heading text-base font-bold text-white/90">{course.category}</p>
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/10" aria-hidden="true" />
            <div className="absolute inset-x-4 top-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-[var(--ca-navy-900)] shadow-sm backdrop-blur-sm">{course.badge_label?.trim() || course.category}</span>
              {heroMode && <span className="inline-flex items-center rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm backdrop-blur-sm">{heroMode}</span>}
              {course.language && <span className="inline-flex items-center rounded-full bg-[rgba(212,175,55,0.95)] px-2.5 py-1 text-[11px] font-bold text-[#1a1304] shadow-sm backdrop-blur-sm">{course.language}</span>}
            </div>
          </div>

          <h1 className="mt-5 font-heading text-3xl font-extrabold leading-[1.12] tracking-tight text-[var(--ca-navy-900)] sm:text-4xl">{course.title}</h1>
          {course.description && <p className="mt-3 max-w-3xl text-[var(--ca-slate-700)]">{course.description}</p>}

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--ca-slate-700)]">
            {meta.map((m, i) => (
              <span key={i} className="inline-flex items-center gap-1.5"><m.icon size={15} className="text-[var(--ca-gold)]" aria-hidden="true" /> {m.label}</span>
            ))}
          </div>

          {countdownStart && (
            <div className="mt-5 max-w-md">
              <BatchCountdown startISO={countdownStart} />
            </div>
          )}
        </section>

        {/* Main + sticky sidebar */}
        <div className="mt-8 grid gap-8 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            {/* What's included */}
            {(included.length > 0 || notIncluded.length > 0) && (
              <section id="included" className="scroll-mt-24">
                <h2 className="font-heading text-2xl font-extrabold text-[var(--ca-navy-900)]">What&apos;s included</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {included.length > 0 && (
                    <div className="rounded-2xl border border-[var(--ca-slate-200)] bg-white p-5 shadow-soft-sm">
                      <ul className="space-y-2.5 text-sm text-[var(--ca-slate-700)]">
                        {included.map((x) => (
                          <li key={x} className="flex items-start gap-2.5"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#16a34a]" aria-hidden="true" /> <span>{x}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {notIncluded.length > 0 && (
                    <div className="rounded-2xl border border-[var(--ca-slate-200)] bg-white p-5 shadow-soft-sm">
                      <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-[var(--ca-slate-400)]">Not included</p>
                      <ul className="space-y-2.5 text-sm text-[var(--ca-slate-700)]">
                        {notIncluded.map((x) => (
                          <li key={x} className="flex items-start gap-2.5"><XCircle size={18} className="mt-0.5 shrink-0 text-[var(--ca-slate-400)]" aria-hidden="true" /> <span>{x}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Brochures from the central library */}
            {(brochures.length > 0 || course.brochure_link) && (
              <section className="mt-10">
                <h2 className="font-heading text-2xl font-extrabold text-[var(--ca-navy-900)]">Brochures &amp; resources</h2>
                <div className="mt-4">
                  {brochures.length > 0 ? (
                    <BrochureCards docs={brochures} />
                  ) : (
                    <a href={course.brochure_link!} target="_blank" rel="noopener noreferrer" className="ca-btn ca-btn-outline ca-focus text-sm">Download brochure</a>
                  )}
                </div>
              </section>
            )}

            {/* Rich marketing body: about, learn, who, get, mentor, reviews, resources, contact, faq */}
            <div id="overview" className="scroll-mt-24">
              <LandingSections
                view={view}
                aboutTitle="About this course"
                aboutFallback={course.long_description || course.description}
                whoTitle="Who is this for?"
                faqs={faqItems}
                resources={course.pdf_resources}
                contactLinks={course.contact_links}
                resourcesTitle="Downloads & resources"
              />
            </div>

            {/* Curriculum */}
            {curriculum.length > 0 && (
              <section id="curriculum" className="mt-10 scroll-mt-24">
                <h2 className="font-heading text-2xl font-extrabold text-[var(--ca-navy-900)]">Curriculum</h2>
                <div className="mt-4 space-y-3">
                  {curriculum.map((m, i) => (
                    <details key={i} className="group overflow-hidden rounded-2xl border border-[var(--ca-slate-200)] bg-white shadow-soft-sm">
                      <summary className="ca-focus flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-semibold text-[var(--ca-navy-900)]">
                        <span className="flex items-center gap-2.5"><BookOpen size={18} className="shrink-0 text-[var(--ca-gold)]" aria-hidden="true" /> {m.title}</span>
                        <ChevronDown size={18} className="shrink-0 text-[var(--ca-slate-400)] transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                      </summary>
                      {m.lectures?.length > 0 && (
                        <ul className="space-y-1.5 border-t border-[var(--ca-slate-200)] p-4 text-sm text-[var(--ca-slate-700)]">
                          {m.lectures.map((l, j) => (
                            <li key={j} className="flex items-center justify-between gap-3">
                              <span className="min-w-0">{l.title}</span>
                              {l.duration && <span className="shrink-0 text-[var(--ca-slate-400)]">{l.duration}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  ))}
                </div>
              </section>
            )}

            {/* Schedule */}
            {course.schedule && (
              <section className="mt-10">
                <h2 className="font-heading text-2xl font-extrabold text-[var(--ca-navy-900)]">Schedule</h2>
                <p className="mt-3 text-[var(--ca-slate-700)]">{course.schedule}</p>
              </section>
            )}

            {/* Fees & EMI */}
            {course.price > 0 && (
              <section id="fees" className="mt-10 scroll-mt-24">
                <h2 className="font-heading text-2xl font-extrabold text-[var(--ca-navy-900)]">Fees &amp; EMI</h2>
                <div className="mt-4 rounded-2xl border border-[var(--ca-slate-200)] bg-white p-5 text-sm text-[var(--ca-slate-700)] shadow-soft-sm">
                  <p>Standard fee: <b className="text-[var(--ca-navy-900)]">{formatINR(course.price)}</b>{course.gst ? " (GST incl.)" : ""}</p>
                  {fullSavings > 0 && (
                    <p className="mt-2">Pay in full and save <b className="text-[#16a34a]">{formatINR(fullSavings)}</b> — pay just <b className="text-[var(--ca-navy-900)]">{formatINR(payInFull)}</b> today.</p>
                  )}
                  {emiLine && <p className="mt-2">{emiLine}</p>}
                  {course.brochure_link && (
                    <a href={course.brochure_link} target="_blank" rel="noopener noreferrer" className="ca-btn ca-btn-outline ca-focus mt-4 text-sm">Download brochure</a>
                  )}
                </div>
              </section>
            )}

            {/* Foundation comparison (kept contained) */}
            {comparison.length > 1 && (
              <section className="mt-10">
                <h2 className="font-heading text-2xl font-extrabold text-[var(--ca-navy-900)]">Compare foundation programs</h2>
                <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--ca-slate-200)] bg-white shadow-soft-sm">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--ca-slate-200)] text-xs uppercase tracking-wide text-[var(--ca-slate-400)]">
                        <th className="p-3">Program</th><th className="p-3">Mode</th><th className="p-3">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.map((c) => (
                        <tr key={c.id} className="border-b border-[var(--ca-slate-200)] last:border-0">
                          <td className="p-3 font-medium text-[var(--ca-navy-900)]">{c.title}</td>
                          <td className="p-3">{c.modes.join(", ")}</td>
                          <td className="p-3">{formatINR(c.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Related */}
            {related.length > 0 && (
              <section className="mt-12">
                <h2 className="font-heading text-2xl font-extrabold text-[var(--ca-navy-900)]">Related courses</h2>
                <div className="mt-5 grid gap-6 sm:grid-cols-2">
                  {related.map((c) => <CourseCard key={c.id} course={c} />)}
                </div>
              </section>
            )}
          </div>

          {/* Sticky pricing card (desktop) */}
          <aside className="min-w-0">
            <div className="lg:sticky lg:top-24">
              <div className="rounded-2xl bg-gradient-to-b from-white/70 via-[var(--ca-slate-200)] to-[rgba(212,175,55,0.45)] p-px shadow-[0_1px_2px_rgba(10,26,63,0.05),0_22px_50px_-28px_rgba(10,26,63,0.35)]">
                <div className="rounded-[15px] bg-white p-6">
                  {purchase ? (
                    <div className="mb-3 rounded-xl border border-[#16a34a]/30 bg-[#16a34a]/10 p-3">
                      <p className="inline-flex items-center gap-1.5 font-heading text-base font-bold text-[#15803d]"><CheckCircle2 size={18} aria-hidden="true" /> You&apos;re enrolled</p>
                      <p className="mt-1 text-sm text-[var(--ca-slate-700)]">
                        {purchase.label}{purchase.remaining > 0 ? ` · balance ${formatINR(purchase.remaining)}` : " · full access unlocked"}.
                      </p>
                    </div>
                  ) : (
                    <>
                  {off && <span className="mb-2 inline-flex items-center rounded-full bg-[rgba(212,175,55,0.16)] px-2.5 py-1 text-[11px] font-extrabold text-[#8a6d12]">{off}% OFF — limited time</span>}
                  <div className="flex items-baseline gap-2">
                    {course.price === 0 ? (
                      <span className="font-heading text-3xl font-extrabold text-[#16a34a]">Free</span>
                    ) : (
                      <>
                        {priceVaries && <span className="text-sm font-semibold text-[var(--ca-slate-400)]">From</span>}
                        <span className="font-heading text-3xl font-extrabold text-[var(--ca-navy-900)]">{formatINR(priceVaries ? displayPrice : course.price)}</span>
                        {!priceVaries && course.original_price && course.original_price > course.price && (
                          <span className="text-[var(--ca-slate-400)] line-through">{formatINR(course.original_price)}</span>
                        )}
                      </>
                    )}
                  </div>
                  {priceVaries ? (
                    <p className="mt-1 text-sm text-[var(--ca-slate-700)]">Multiple batches — choose your batch &amp; plan at checkout</p>
                  ) : (
                    <>
                      {fullSavings > 0 && <p className="mt-1 text-sm font-semibold text-[#16a34a]">Pay in full {formatINR(payInFull)} — save {formatINR(fullSavings)}</p>}
                      {emiCfg.enabled && emiCfg.installmentCounts.length > 0 && <p className="mt-1 text-sm text-[var(--ca-slate-700)]">or EMI / book your seat at checkout</p>}
                    </>
                  )}
                    </>
                  )}

                  <div className="mt-3"><SeatCounter seat={view.seat} compact /></div>

                  <Link href={enrollHref} className="ca-btn ca-btn-gold ca-focus mt-5 w-full justify-center">{enrollLabel} <ArrowRight size={16} /></Link>
                  <Link href="/demo" className="ca-btn ca-btn-outline ca-focus mt-2 w-full justify-center">Book a Free Demo</Link>
                  <WhatsAppButton config={view.whatsapp} className="mt-2 w-full justify-center" />

                  <div className="mt-5 space-y-2 border-t border-[var(--ca-slate-200)] pt-4 text-sm text-[var(--ca-slate-700)]">
                    <p className="flex items-center gap-2"><ShieldCheck size={16} className="text-[#16a34a]" aria-hidden="true" /> Secure payment</p>
                    <p className="flex items-center gap-2"><Headphones size={16} className="text-[var(--ca-navy-600)]" aria-hidden="true" /> Mentor &amp; doubt support</p>
                  </div>

                  {included.length > 0 && (
                    <ul className="mt-4 space-y-2 text-sm text-[var(--ca-slate-700)]">
                      {included.slice(0, 4).map((x) => (
                        <li key={x} className="flex items-start gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#16a34a]" aria-hidden="true" /> <span>{x}</span></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Final CTA band */}
      <section className="ca-dark ca-grain relative overflow-hidden">
        <div className="ca-orb" style={{ width: 260, height: 260, top: -130, right: -50, background: "rgba(212,175,55,0.18)" }} />
        <div className="container-wide relative py-12 text-center sm:py-16">
          <h2 className="ca-hero-title mx-auto max-w-2xl font-heading text-2xl font-extrabold leading-[1.15] sm:text-3xl">Ready to start your UPSC journey?</h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--ca-slate-300)]">Join {course.title} and learn with a results-first, personal mentorship approach.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href={enrollHref} className="ca-btn ca-btn-gold ca-focus">{enrollLabel} <ArrowRight size={16} /></Link>
            <Link href="/demo" className="ca-btn ca-btn-glass ca-focus">Book a Free Demo</Link>
          </div>
        </div>
      </section>

      {/* Mobile sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--ca-slate-200)] bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <p className="text-[11px] leading-none text-[var(--ca-slate-400)]">{purchase ? "Status" : "Price"}</p>
            <p className={`font-heading text-lg font-bold leading-tight ${purchase ? "text-[#16a34a]" : "text-[var(--ca-navy-900)]"}`}>{purchase ? purchase.label : priceLabel}</p>
          </div>
          <Link href={enrollHref} className="ca-btn ca-btn-gold ca-focus flex-1 justify-center">{enrollLabel}</Link>
          <WhatsAppButton config={view.whatsapp} className="px-3" />
        </div>
      </div>
    </div>
  );
}
