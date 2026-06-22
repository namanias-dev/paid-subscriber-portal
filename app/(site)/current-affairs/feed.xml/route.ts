import { getPublicCaArticles } from "@/lib/dataProvider";
import { SITE_URL, ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

function escapeXml(s: string): string {
  return (s || "").replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string)
  );
}

export async function GET() {
  let articles = await getPublicCaArticles().catch(() => []);
  articles = articles.filter((a) => a.seo?.noindex !== true).slice(0, 30);

  const base = `${SITE_URL}/current-affairs`;
  const items = articles
    .map((a) => {
      const url = `${base}/${a.seo?.canonical_slug?.trim() || a.slug}`;
      const date = new Date(a.publish_at || a.created_at).toUTCString();
      return `    <item>
      <title>${escapeXml(a.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${escapeXml(a.summary)}</description>
      <pubDate>${date}</pubDate>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(`${ACADEMY.name} — UPSC Current Affairs`)}</title>
    <link>${base}</link>
    <description>Daily UPSC current affairs, editorials and analysis.</description>
    <language>en-in</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=900, s-maxage=900",
    },
  });
}
