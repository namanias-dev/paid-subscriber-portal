import type { Metadata } from "next";
import Link from "next/link";
import { FileText, CalendarRange } from "lucide-react";
import CaPdfButton from "@/components/public/ca/CaPdfButton";
import CaLeadForm from "@/components/public/ca/CaLeadForm";
import CaPageHeader from "@/components/public/ca/CaPageHeader";
import { CaIconChip } from "@/components/public/ca/CaIcons";
import { getPublicCaArticles, getCaPdfs } from "@/lib/dataProvider";
import { caMetadata, caMonthLabel, caEffectiveDate } from "@/lib/caView";
import { ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return caMetadata({
    title: `Monthly Current Affairs Compilations (PDF) | ${ACADEMY.shortName}`,
    description: "Download month-wise UPSC current affairs compilation PDFs — concise, exam-ready and free.",
    path: "/current-affairs/monthly",
  });
}

export default async function MonthlyIndex() {
  const [articles, pdfs] = await Promise.all([getPublicCaArticles(), getCaPdfs()]);
  const monthlyPdfs = pdfs.filter((p) => p.kind === "monthly").sort((a, b) => (a.date_ref || "") < (b.date_ref || "") ? 1 : -1);

  const months = Array.from(new Set(articles.map((a) => caEffectiveDate(a).slice(0, 7)))).sort().reverse();

  return (
    <div>
      <CaPageHeader
        eyebrow="Monthly Compilations"
        title="Monthly Compilations"
        subtitle="Download month-wise current affairs PDFs and browse each month's articles."
        icon={FileText}
        crumbs={[{ label: "Current Affairs", href: "/current-affairs" }, { label: "Monthly" }]}
      />
      <div className="container-wide py-12">
        {monthlyPdfs.length > 0 && (
          <section>
            <h2 className="mb-5 font-heading text-xl font-bold tracking-tight text-[var(--ca-navy-900)]">Compilation PDFs</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {monthlyPdfs.map((p) => (
                <div key={p.id} className="ca-card flex flex-col p-5">
                  <CaIconChip icon={FileText} variant="light" />
                  <p className="mt-3 font-semibold leading-tight text-[var(--ca-navy-900)]">{p.title}</p>
                  <p className="text-xs text-[var(--ca-slate-400)]">{caMonthLabel(p.date_ref)}</p>
                  <div className="mt-3"><CaPdfButton pdf={p} /></div>
                </div>
              ))}
            </div>
          </section>
        )}

        {months.length > 0 && (
          <section className="mt-14">
            <h2 className="mb-5 font-heading text-xl font-bold tracking-tight text-[var(--ca-navy-900)]">Browse by month</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {months.map((m) => (
                <Link key={m} href={`/current-affairs/monthly/${m}`} className="ca-card ca-focus flex items-center gap-3 p-4 font-semibold text-[var(--ca-navy-900)]">
                  <CaIconChip icon={CalendarRange} variant="light" size={18} />
                  {caMonthLabel(m)}
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="mt-14"><CaLeadForm source="ca-monthly" title="Get the latest monthly compilation free" /></section>
      </div>
    </div>
  );
}
