import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Clock, ListChecks, ArrowRight } from "lucide-react";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaPdfButton from "@/components/public/ca/CaPdfButton";
import CaPageHeader from "@/components/public/ca/CaPageHeader";
import { getPublicCaArticles, getPublicCaPdfsByKind, getQuizBySlug } from "@/lib/dataProvider";
import { caMetadata, caDateLabel, caEffectiveDate } from "@/lib/caView";
import { caCategoryName } from "@/lib/caConstants";
import { ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function generateMetadata({ params }: { params: { date: string } }): Promise<Metadata> {
  const label = caDateLabel(params.date);
  return caMetadata({
    title: `Current Affairs — ${label} (PDF & Articles) | ${ACADEMY.shortName}`,
    description: `UPSC current affairs for ${label}: daily compilation PDF, editorials, Prelims facts and Mains analysis.`,
    path: `/current-affairs/daily/${params.date}`,
  });
}

export default async function DailyDate({
  params,
  searchParams,
}: {
  params: { date: string };
  searchParams: Record<string, string | undefined>;
}) {
  if (!DATE_RE.test(params.date)) notFound();
  const [articles, dailyPdfs] = await Promise.all([
    getPublicCaArticles(),
    getPublicCaPdfsByKind("daily"),
  ]);

  const dayArticles = articles.filter((a) => caEffectiveDate(a) === params.date);
  const dayPdfs = dailyPdfs.filter((p) => (p.date_ref || p.created_at).slice(0, 10) === params.date);

  // Prev/next day across the union of dates that have a PDF and/or articles.
  const allDates = Array.from(
    new Set([
      ...articles.map((a) => caEffectiveDate(a)),
      ...dailyPdfs.map((p) => (p.date_ref || p.created_at).slice(0, 10)),
    ])
  ).sort((a, b) => (a < b ? 1 : -1));
  const idx = allDates.indexOf(params.date);
  const newerDate = idx > 0 ? allDates[idx - 1] : null;
  const olderDate = idx >= 0 && idx < allDates.length - 1 ? allDates[idx + 1] : null;

  // Category filter (within this date only).
  const activeCat = searchParams.cat || "";
  const cats = Array.from(new Set(dayArticles.map((a) => a.category_slug).filter(Boolean))) as string[];
  const shownArticles = activeCat ? dayArticles.filter((a) => a.category_slug === activeCat) : dayArticles;

  // Related daily quiz: first quiz linked from any of the day's articles.
  const quizSlug = dayArticles.map((a) => a.related_quiz_slug).find(Boolean) || null;
  const quiz = quizSlug ? await getQuizBySlug(quizSlug) : null;

  const base = `/current-affairs/daily/${params.date}`;

  return (
    <div className="bg-[var(--ca-slate-50)]">
      <CaPageHeader
        eyebrow="Daily Current Affairs"
        title={`Current Affairs — ${caDateLabel(params.date)}`}
        icon={CalendarDays}
        crumbs={[{ label: "Current Affairs", href: "/current-affairs" }, { label: "Daily", href: "/current-affairs/daily" }, { label: caDateLabel(params.date) }]}
      />

      {/* Content panel overlaps the hero for a smooth transition */}
      <div className="relative z-10 -mt-10 rounded-t-[2rem] bg-[var(--ca-slate-50)]">
        <div className="container-wide py-10 sm:py-12">
          {/* Day navigation */}
          <div className="mb-6 flex items-center justify-between gap-3">
            {olderDate ? (
              <Link href={`/current-affairs/daily/${olderDate}`} className="ca-btn ca-btn-outline ca-focus text-sm"><ChevronLeft size={16} /> <span className="hidden sm:inline">{caDateLabel(olderDate)}</span><span className="sm:hidden">Prev</span></Link>
            ) : <span />}
            {newerDate ? (
              <Link href={`/current-affairs/daily/${newerDate}`} className="ca-btn ca-btn-outline ca-focus text-sm"><span className="hidden sm:inline">{caDateLabel(newerDate)}</span><span className="sm:hidden">Next</span> <ChevronRight size={16} /></Link>
            ) : <span />}
          </div>

          {/* One cohesive day group */}
          <section className="overflow-hidden rounded-3xl border border-[var(--ca-slate-200)] bg-white p-5 shadow-[0_18px_40px_-26px_rgba(10,26,63,0.22)] sm:p-6">
            {/* Daily PDF(s) */}
            <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-bold tracking-tight text-[var(--ca-navy-900)] sm:text-xl"><FileText size={20} className="text-[var(--ca-gold)]" /> Daily Current Affairs PDF</h2>
            {dayPdfs.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {dayPdfs.map((p) => <CaPdfButton key={p.id} pdf={p} />)}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-2xl border border-dashed border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] px-4 py-4 text-sm text-[var(--ca-slate-400)]">
                <Clock size={16} /> Daily PDF coming soon for this date.
              </div>
            )}

            {/* Related daily quiz */}
            {quiz && (
              <div className="ca-dark ca-grain relative mt-6 overflow-hidden rounded-2xl p-6">
                <div className="ca-orb" style={{ width: 200, height: 200, top: -100, right: -40, background: "rgba(212,175,55,0.18)" }} />
                <p className="ca-eyebrow flex items-center gap-1.5"><ListChecks size={14} /> Test yourself</p>
                <h3 className="mt-2 font-heading text-lg font-bold text-white">{quiz.title}</h3>
                <p className="mt-1 text-sm text-[var(--ca-slate-300)]">Attempt the related current affairs quiz for {caDateLabel(params.date)}.</p>
                <Link href={`/quizzes/${quiz.slug}`} className="ca-btn ca-btn-gold ca-focus mt-4">Attempt the quiz <ArrowRight size={16} /></Link>
              </div>
            )}

            <div className="ca-divider my-6" />

            {/* Articles */}
            <h2 className="mb-4 font-heading text-lg font-bold tracking-tight text-[var(--ca-navy-900)] sm:text-xl">Articles on this date</h2>
            {cats.length > 1 && (
              <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
                <Link href={base} className={`ca-filter ca-focus ${!activeCat ? "ca-filter--active" : ""}`}>All</Link>
                {cats.map((c) => (
                  <Link key={c} href={`${base}?cat=${c}`} className={`ca-filter ca-focus ${activeCat === c ? "ca-filter--active" : ""}`}>{caCategoryName(c)}</Link>
                ))}
              </div>
            )}
            {shownArticles.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {shownArticles.map((a) => <CaArticleCard key={a.id} article={a} compact />)}
              </div>
            ) : (
              <p className="flex items-center gap-2 rounded-2xl border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] p-8 text-center text-[var(--ca-slate-700)]"><FileText size={16} /> No individual articles for this date.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
