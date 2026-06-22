import type { Metadata } from "next";
import Link from "next/link";
import { Archive, ArrowRight } from "lucide-react";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaPageHeader from "@/components/public/ca/CaPageHeader";
import { getPublicCaArticles } from "@/lib/dataProvider";
import { caMetadata, caDateLabel, groupByDate } from "@/lib/caView";
import { ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return caMetadata({
    title: `Daily Current Affairs Archive | ${ACADEMY.shortName}`,
    description: "Browse the complete day-wise archive of UPSC current affairs — every day's editorials, Prelims facts and analysis.",
    path: "/current-affairs/daily",
  });
}

export default async function DailyArchive() {
  const articles = await getPublicCaArticles();
  const groups = groupByDate(articles);

  return (
    <div>
      <CaPageHeader
        eyebrow="Daily Archive"
        title="Daily Current Affairs Archive"
        subtitle="Every day's current affairs, organised by date."
        icon={Archive}
        crumbs={[{ label: "Current Affairs", href: "/current-affairs" }, { label: "Daily" }]}
      />
      <div className="container-wide py-12">
        {groups.length === 0 ? (
          <p className="rounded-2xl border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] p-10 text-center text-[var(--ca-slate-700)]">No articles published yet.</p>
        ) : (
          <div className="space-y-12">
            {groups.map((g) => (
              <section key={g.date}>
                <div className="mb-4 flex items-end justify-between">
                  <h2 className="font-heading text-xl font-bold tracking-tight text-[var(--ca-navy-900)]">{caDateLabel(g.date)}</h2>
                  <Link href={`/current-affairs/daily/${g.date}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ca-navy-600)]">View day <ArrowRight size={15} /></Link>
                </div>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.slice(0, 6).map((a) => <CaArticleCard key={a.id} article={a} compact />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
