import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaPdfButton from "@/components/public/ca/CaPdfButton";
import { getPublicCaArticles, getCaPdfs } from "@/lib/dataProvider";
import { caMetadata, caMonthLabel, caEffectiveDate } from "@/lib/caView";
import { ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-\d{2}$/;

export async function generateMetadata({ params }: { params: { month: string } }): Promise<Metadata> {
  const label = caMonthLabel(params.month);
  return caMetadata({
    title: `${label} Current Affairs — Articles & PDF | ${ACADEMY.shortName}`,
    description: `All UPSC current affairs for ${label} with the monthly compilation PDF.`,
    path: `/current-affairs/monthly/${params.month}`,
  });
}

export default async function MonthlyMonth({ params }: { params: { month: string } }) {
  if (!MONTH_RE.test(params.month)) notFound();
  const [articles, pdfs] = await Promise.all([getPublicCaArticles(), getCaPdfs()]);
  const items = articles.filter((a) => caEffectiveDate(a).slice(0, 7) === params.month);
  const monthPdf = pdfs.find((p) => p.kind === "monthly" && p.date_ref === params.month);

  return (
    <div className="container-wide py-10">
      <nav className="mb-4 text-xs text-muted">
        <Link href="/current-affairs" className="hover:text-ink">Current Affairs</Link> / <Link href="/current-affairs/monthly" className="hover:text-ink">Monthly</Link> / {caMonthLabel(params.month)}
      </nav>
      <h1 className="font-heading text-3xl font-extrabold sm:text-4xl">{caMonthLabel(params.month)} Current Affairs</h1>

      {monthPdf && (
        <div className="mt-6 max-w-md"><CaPdfButton pdf={monthPdf} /></div>
      )}

      {items.length === 0 ? (
        <p className="mt-10 rounded-xl border border-line bg-surface p-8 text-center text-ink2">No articles for this month yet.</p>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => <CaArticleCard key={a.id} article={a} />)}
        </div>
      )}
    </div>
  );
}
