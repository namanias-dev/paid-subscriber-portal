import type { Metadata } from "next";
import Link from "next/link";
import { Archive, ArrowRight, FileText, Clock } from "lucide-react";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaPdfButton from "@/components/public/ca/CaPdfButton";
import CaPageHeader from "@/components/public/ca/CaPageHeader";
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
    <div>
      <CaPageHeader
        eyebrow="Daily Current Affairs PDFs"
        title="Daily Current Affairs PDFs & Articles"
        subtitle="Download each day's compilation PDF and read that day's individual current affairs — organised date-wise."
        icon={Archive}
        crumbs={[{ label: "Current Affairs", href: "/current-affairs" }, { label: "Daily" }]}
      />
      <div className="container-wide py-12">
        {dates.length === 0 ? (
          <p className="rounded-2xl border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] p-10 text-center text-[var(--ca-slate-700)]">No daily current affairs published yet.</p>
        ) : (
          <div className="space-y-14">
            {dates.map((date) => {
              const pdfs = pdfsByDate.get(date) || [];
              const items = articlesByDate.get(date) || [];
              return (
                <section key={date}>
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <h2 className="font-heading text-xl font-bold tracking-tight text-[var(--ca-navy-900)] sm:text-2xl">{caDateLabel(date)}</h2>
                    <Link href={`/current-affairs/daily/${date}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ca-navy-600)]">Open day <ArrowRight size={15} /></Link>
                  </div>

                  {pdfs.length > 0 ? (
                    <div className="mb-5 grid gap-3 sm:grid-cols-2">
                      {pdfs.map((p) => <CaPdfButton key={p.id} pdf={p} />)}
                    </div>
                  ) : (
                    <div className="mb-5 flex items-center gap-2 rounded-2xl border border-dashed border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] px-4 py-3 text-sm text-[var(--ca-slate-400)]">
                      <Clock size={15} /> Daily PDF coming soon for this date.
                    </div>
                  )}

                  {items.length > 0 ? (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      {items.slice(0, 6).map((a) => <CaArticleCard key={a.id} article={a} compact />)}
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-[var(--ca-slate-400)]"><FileText size={15} /> No individual articles for this date.</p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
