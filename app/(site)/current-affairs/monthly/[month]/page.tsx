import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarRange } from "lucide-react";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaPdfButton from "@/components/public/ca/CaPdfButton";
import CaPageHeader from "@/components/public/ca/CaPageHeader";
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
    <div>
      <CaPageHeader
        eyebrow="Monthly Current Affairs"
        title={`${caMonthLabel(params.month)} Current Affairs`}
        icon={CalendarRange}
        crumbs={[{ label: "Current Affairs", href: "/current-affairs" }, { label: "Monthly", href: "/current-affairs/monthly" }, { label: caMonthLabel(params.month) }]}
      />
      <div className="container-wide py-12">
        {monthPdf && <div className="mb-8 max-w-md"><CaPdfButton pdf={monthPdf} /></div>}

        {items.length === 0 ? (
          <p className="rounded-2xl border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] p-10 text-center text-[var(--ca-slate-700)]">No articles for this month yet.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => <CaArticleCard key={a.id} article={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}
