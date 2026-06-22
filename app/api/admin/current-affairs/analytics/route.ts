import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getCaArticles, getCaPdfs, getCaEvents, getCaLeads } from "@/lib/dataProvider";
import { caCategoryName } from "@/lib/caConstants";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const [articles, pdfs, events, leads] = await Promise.all([
    getCaArticles(),
    getCaPdfs(),
    getCaEvents(),
    getCaLeads(),
  ]);

  const byType = (t: string) => events.filter((e) => e.type === t).length;

  const mostRead = [...articles]
    .sort((a, b) => b.views - a.views)
    .slice(0, 10)
    .map((a) => ({ slug: a.slug, title: a.title, views: a.views }));

  const mostDownloaded = [...pdfs]
    .sort((a, b) => b.download_count - a.download_count)
    .slice(0, 10)
    .map((p) => ({ id: p.id, title: p.title, downloads: p.download_count }));

  const catMap = new Map<string, { views: number; count: number }>();
  for (const a of articles) {
    const key = a.category_slug || "uncategorized";
    const cur = catMap.get(key) || { views: 0, count: 0 };
    cur.views += a.views;
    cur.count += 1;
    catMap.set(key, cur);
  }
  const categoryPerformance = Array.from(catMap.entries())
    .map(([slug, v]) => ({ slug, name: caCategoryName(slug), ...v }))
    .sort((a, b) => b.views - a.views);

  const analytics = {
    totals: {
      articles: articles.length,
      published: articles.filter((a) => a.status === "published").length,
      totalViews: articles.reduce((s, a) => s + a.views, 0),
      pdfDownloads: pdfs.reduce((s, p) => s + p.download_count, 0),
      ctaClicks: byType("cta_click"),
      quizClicks: byType("quiz_click"),
      leads: leads.length,
    },
    mostRead,
    mostDownloaded,
    categoryPerformance,
  };
  return NextResponse.json({ ok: true, analytics });
}
