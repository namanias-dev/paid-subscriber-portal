import type { Metadata } from "next";
import Link from "next/link";
import { Archive, ArrowRight, FileText, Clock, ChevronRight } from "lucide-react";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaPdfButton from "@/components/public/ca/CaPdfButton";
import { CaIconChip } from "@/components/public/ca/CaIcons";
import { getPublicCaArticles, getPublicCaPdfsByKind } from "@/lib/dataProvider";
import { caMetadata, caDateLabel, groupByDate } from "@/lib/caView";
import { ACADEMY } from "@/lib/config";
import type { CaArticle, CaPdf } from "@/lib/types";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return caMetadata({
    title: `Daily Current Affairs PDFs & Articles | ${ACADEMY.shortName}`,
    description: "Download daily UPSC current affairs PDFs and read each day's editorials, Prelims facts and analysis — organised date-wise.",
    path: "/current-affairs/daily",
  });
}

export default async function DailyArchive() {
  const [articles, dailyPdfs] = await Promise.all([
    getPublicCaArticles(),
    getPublicCaPdfsByKind("daily"),
  ]);

  // Merge article-dates and daily-PDF dates into one date-keyed view (newest first).
  const articleGroups = groupByDate(articles);
  const articlesByDate = new Map<string, CaArticle[]>(articleGroups.map((g) => [g.date, g.items]));
  const pdfsByDate = new Map<string, CaPdf[]>();
  for (const p of dailyPdfs) {
    const key = (p.date_ref || p.created_at).slice(0, 10);
    pdfsByDate.set(key, [...(pdfsByDate.get(key) || []), p]);
  }
  const dates = Array.from(new Set([...articlesByDate.keys(), ...pdfsByDate.keys()])).sort((a, b) => (a < b ? 1 : -1));

  return (
    <div className="bg-[var(--ca-slate-50)]">
      {/* Hero */}
      <header className="ca-dark ca-grain relative overflow-hidden">
        <div className="ca-orb" style={{ width: 320, height: 320, top: -130, right: -70, background: "rgba(212,175,55,0.16)" }} />
        <div className="container-wide relative pt-10 pb-24 sm:pt-14 sm:pb-28">
          <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--ca-slate-400)]">
            <Link href="/current-affairs" className="ca-focus transition hover:text-[var(--ca-gold-bright)]">Current Affairs</Link>
            <ChevronRight size={13} aria-hidden="true" />
            <span className="text-[var(--ca-slate-300)]">Daily</span>
          </nav>
          <div className="flex items-start gap-4">
            <CaIconChip icon={Archive} />
            <div className="min-w-0">
              <p className="ca-eyebrow">Daily Current Affairs PDFs</p>
              <h1 className="mt-2 pb-[0.06em] font-heading text-3xl font-extrabold leading-[1.18] tracking-tight text-white sm:text-4xl lg:text-5xl">
                Daily Current Affairs — PDFs &amp; Articles
              </h1>
              <p className="mt-3 max-w-2xl text-[var(--ca-slate-300)]">Download each day&apos;s compilation PDF and read that day&apos;s individual current affairs — neatly organised by date.</p>
            </div>
          </div>
        </div>
      </header>

      {/* Content panel overlaps the hero for a smooth transition */}
      <div className="relative z-10 -mt-14 rounded-t-[2rem] bg-[var(--ca-slate-50)] sm:-mt-16">
        <div className="container-wide py-10 sm:py-12">
          {dates.length === 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="ca-skeleton h-64" />)}
            </div>
          ) : (
            <div className="space-y-8">
              {dates.map((date) => {
                const pdfs = pdfsByDate.get(date) || [];
                const items = articlesByDate.get(date) || [];
                return (
                  <section key={date} className="overflow-hidden rounded-3xl border border-[var(--ca-slate-200)] bg-white shadow-[0_18px_40px_-26px_rgba(10,26,63,0.22)]">
                    <div className="p-5 sm:p-6">
                      {/* Date header row */}
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 className="font-heading text-lg font-bold tracking-tight text-[var(--ca-navy-900)] sm:text-xl">{caDateLabel(date)}</h2>
                        <Link href={`/current-affairs/daily/${date}`} className="ca-focus inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[var(--ca-navy-600)] hover:text-[var(--ca-gold)]">Open day <ArrowRight size={15} /></Link>
                      </div>

                      {/* Daily PDF(s) */}
                      {pdfs.length > 0 ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {pdfs.map((p) => <CaPdfButton key={p.id} pdf={p} />)}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] px-4 py-3 text-sm text-[var(--ca-slate-400)]">
                          <Clock size={15} /> Daily PDF coming soon for this date.
                        </div>
                      )}

                      {/* That day's articles */}
                      {items.length > 0 ? (
                        <>
                          <div className="ca-divider my-5" />
                          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                            {items.slice(0, 6).map((a) => <CaArticleCard key={a.id} article={a} compact />)}
                          </div>
                          {items.length > 6 && (
                            <div className="mt-5 text-center">
                              <Link href={`/current-affairs/daily/${date}`} className="ca-btn ca-btn-outline ca-focus text-sm">View all {items.length} articles <ArrowRight size={15} /></Link>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="mt-4 flex items-center gap-2 text-sm text-[var(--ca-slate-400)]"><FileText size={15} /> No individual articles for this date.</p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
