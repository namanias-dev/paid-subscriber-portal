import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays } from "lucide-react";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaPageHeader from "@/components/public/ca/CaPageHeader";
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
    <div>
      <CaPageHeader
        eyebrow="Daily Current Affairs"
        title={`Current Affairs — ${caDateLabel(params.date)}`}
        icon={CalendarDays}
        crumbs={[{ label: "Current Affairs", href: "/current-affairs" }, { label: "Daily", href: "/current-affairs/daily" }, { label: caDateLabel(params.date) }]}
      />
      <div className="container-wide py-12">
        {items.length === 0 ? (
          <p className="rounded-2xl border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] p-10 text-center text-[var(--ca-slate-700)]">No articles for this date. <Link href="/current-affairs/daily" className="font-semibold text-[var(--ca-navy-600)] underline">Back to archive</Link></p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => <CaArticleCard key={a.id} article={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}
