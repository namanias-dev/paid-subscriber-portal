import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import { getPublicCaArticles } from "@/lib/dataProvider";
import { caMetadata, caDateLabel, caEffectiveDate } from "@/lib/caView";
import { ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function generateMetadata({ params }: { params: { date: string } }): Promise<Metadata> {
  const label = caDateLabel(params.date);
  return caMetadata({
    title: `Current Affairs — ${label} | ${ACADEMY.shortName}`,
    description: `UPSC current affairs for ${label}: editorials, Prelims facts and Mains analysis.`,
    path: `/current-affairs/daily/${params.date}`,
  });
}

export default async function DailyDate({ params }: { params: { date: string } }) {
  if (!DATE_RE.test(params.date)) notFound();
  const articles = await getPublicCaArticles();
  const items = articles.filter((a) => caEffectiveDate(a) === params.date);

  return (
    <div className="container-wide py-10">
      <nav className="mb-4 text-xs text-muted">
        <Link href="/current-affairs" className="hover:text-ink">Current Affairs</Link> / <Link href="/current-affairs/daily" className="hover:text-ink">Daily</Link> / {caDateLabel(params.date)}
      </nav>
      <h1 className="font-heading text-3xl font-extrabold sm:text-4xl">Current Affairs — {caDateLabel(params.date)}</h1>

      {items.length === 0 ? (
        <p className="mt-10 rounded-xl border border-line bg-surface p-8 text-center text-ink2">No articles for this date. <Link href="/current-affairs/daily" className="text-primary">Back to archive</Link></p>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => <CaArticleCard key={a.id} article={a} />)}
        </div>
      )}
    </div>
  );
}
