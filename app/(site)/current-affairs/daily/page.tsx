import type { Metadata } from "next";
import Link from "next/link";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
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
    <div className="container-wide py-10">
      <nav className="mb-4 text-xs text-muted"><Link href="/current-affairs" className="hover:text-ink">Current Affairs</Link> / Daily archive</nav>
      <h1 className="font-heading text-3xl font-extrabold sm:text-4xl">Daily Current Affairs Archive</h1>
      <p className="mt-2 text-ink2">Every day&apos;s current affairs, organised by date.</p>

      {groups.length === 0 ? (
        <p className="mt-10 rounded-xl border border-line bg-surface p-8 text-center text-ink2">No articles published yet.</p>
      ) : (
        <div className="mt-8 space-y-12">
          {groups.map((g) => (
            <section key={g.date}>
              <div className="mb-4 flex items-end justify-between">
                <h2 className="font-heading text-xl font-bold">{caDateLabel(g.date)}</h2>
                <Link href={`/current-affairs/daily/${g.date}`} className="text-sm text-primary">View day →</Link>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.slice(0, 6).map((a) => <CaArticleCard key={a.id} article={a} compact />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
