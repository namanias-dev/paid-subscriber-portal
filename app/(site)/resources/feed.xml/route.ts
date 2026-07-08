import { getPublicResources } from "@/lib/dataProvider";
import { SITE_URL, ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

function escapeXml(s: string): string {
  return (s || "").replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string)
  );
}

export async function GET() {
  let resources = await getPublicResources().catch(() => []);
  resources = resources.filter((r) => r.seo?.noindex !== true).slice(0, 30);

  const base = `${SITE_URL}/resources`;
  const items = resources
    .map((r) => {
      const url = `${base}/${r.slug}`;
      const date = new Date(r.publish_at || r.created_at).toUTCString();
      return `    <item>
      <title>${escapeXml(r.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${escapeXml(r.summary)}</description>
      <pubDate>${date}</pubDate>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(`${ACADEMY.name} — UPSC Resources`)}</title>
    <link>${base}</link>
    <description>Free UPSC preparation guides, strategy, booklists and beginner roadmap.</description>
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
