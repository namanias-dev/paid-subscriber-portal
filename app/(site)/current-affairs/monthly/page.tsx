import type { Metadata } from "next";
import Link from "next/link";
import CaPdfButton from "@/components/public/ca/CaPdfButton";
import CaLeadForm from "@/components/public/ca/CaLeadForm";
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
    <div className="container-wide py-10">
      <nav className="mb-4 text-xs text-muted"><Link href="/current-affairs" className="hover:text-ink">Current Affairs</Link> / Monthly</nav>
      <h1 className="font-heading text-3xl font-extrabold sm:text-4xl">Monthly Compilations</h1>
      <p className="mt-2 text-ink2">Download month-wise current affairs PDFs and browse each month&apos;s articles.</p>

      {monthlyPdfs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 font-heading text-xl font-bold">Compilation PDFs</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {monthlyPdfs.map((p) => (
              <div key={p.id} className="card flex flex-col p-5">
                <span className="text-3xl">📘</span>
                <p className="mt-2 font-semibold leading-tight">{p.title}</p>
                <p className="text-xs text-muted">{caMonthLabel(p.date_ref)}</p>
                <div className="mt-3"><CaPdfButton pdf={p} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {months.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 font-heading text-xl font-bold">Browse by month</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {months.map((m) => (
              <Link key={m} href={`/current-affairs/monthly/${m}`} className="card p-4 text-center font-semibold transition hover:-translate-y-0.5 hover:shadow-md">{caMonthLabel(m)}</Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-12"><CaLeadForm source="ca-monthly" title="Get the latest monthly compilation free" /></section>
    </div>
  );
}
