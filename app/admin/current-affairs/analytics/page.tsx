"use client";

import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, KpiCard, TableShell } from "@/components/admin/ui";

interface Analytics {
  totals: {
    articles: number;
    published: number;
    totalViews: number;
    pdfDownloads: number;
    ctaClicks: number;
    quizClicks: number;
    leads: number;
  };
  mostRead: { slug: string; title: string; views: number }[];
  mostDownloaded: { id: string; title: string; downloads: number }[];
  categoryPerformance: { slug: string; name: string; views: number; count: number }[];
}

export default function CaAnalyticsAdmin() {
  const { data, loading } = useAdminData<Analytics>("/api/admin/current-affairs/analytics", "analytics");
  if (loading) return <LoadingBlock />;
  if (!data) return <p className="text-ink2">No analytics yet.</p>;

  const t = data.totals;

  return (
    <div>
      <PageHeader title="Current Affairs — Analytics" subtitle="Engagement & conversion overview" action={<Link href="/admin/current-affairs" className="btn btn-ghost text-sm">← Articles</Link>} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Articles" value={t.articles} hint={`${t.published} published`} />
        <KpiCard label="Total views" value={t.totalViews} tone="green" />
        <KpiCard label="PDF downloads" value={t.pdfDownloads} tone="amber" />
        <KpiCard label="Leads captured" value={t.leads} tone="blue" />
        <KpiCard label="CTA clicks" value={t.ctaClicks} />
        <KpiCard label="Quiz clicks" value={t.quizClicks} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-heading text-lg font-bold">Most read</h2>
          <TableShell headers={["Article", "Views"]}>
            {data.mostRead.map((a) => (
              <tr key={a.slug} className="border-b border-line last:border-0">
                <td className="px-4 py-2"><a href={`/current-affairs/${a.slug}`} target="_blank" rel="noopener noreferrer" className="text-primary">{a.title}</a></td>
                <td className="px-4 py-2 tabular-nums">{a.views}</td>
              </tr>
            ))}
            {data.mostRead.length === 0 && <tr><td colSpan={2} className="px-4 py-6 text-center text-ink2">No data.</td></tr>}
          </TableShell>
        </div>
        <div>
          <h2 className="mb-2 font-heading text-lg font-bold">Most downloaded</h2>
          <TableShell headers={["PDF", "Downloads"]}>
            {data.mostDownloaded.map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2">{p.title}</td>
                <td className="px-4 py-2 tabular-nums">{p.downloads}</td>
              </tr>
            ))}
            {data.mostDownloaded.length === 0 && <tr><td colSpan={2} className="px-4 py-6 text-center text-ink2">No data.</td></tr>}
          </TableShell>
        </div>
        <div className="lg:col-span-2">
          <h2 className="mb-2 font-heading text-lg font-bold">Category performance</h2>
          <TableShell headers={["Category", "Articles", "Views"]}>
            {data.categoryPerformance.map((c) => (
              <tr key={c.slug} className="border-b border-line last:border-0">
                <td className="px-4 py-2">{c.name}</td>
                <td className="px-4 py-2 tabular-nums">{c.count}</td>
                <td className="px-4 py-2 tabular-nums">{c.views}</td>
              </tr>
            ))}
            {data.categoryPerformance.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-ink2">No data.</td></tr>}
          </TableShell>
        </div>
      </div>
    </div>
  );
}
