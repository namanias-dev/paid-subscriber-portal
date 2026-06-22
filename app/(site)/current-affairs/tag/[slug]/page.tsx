import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import { getPublicCaArticles, getCaTagBySlug } from "@/lib/dataProvider";
import { caMetadata } from "@/lib/caView";
import { ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

const PER_PAGE = 18;

function titleize(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const tag = await getCaTagBySlug(params.slug);
  const name = tag?.name || titleize(params.slug);
  return caMetadata({
    title: `${name} — Current Affairs | ${ACADEMY.shortName}`,
    description: `UPSC current affairs tagged ${name}.`,
    path: `/current-affairs/tag/${params.slug}`,
    seo: tag?.seo,
  });
}

export default async function TagPage({ params, searchParams }: { params: { slug: string }; searchParams: Record<string, string | undefined> }) {
  const all = await getPublicCaArticles();
  const items = all.filter((a) => (a.tags || []).includes(params.slug));
  const tag = await getCaTagBySlug(params.slug);
  if (items.length === 0 && !tag) notFound();
  const name = tag?.name || titleize(params.slug);

  const page = Math.max(1, Number(searchParams.page) || 1);
  const pageItems = items.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));

  return (
    <div className="container-wide py-10">
      <nav className="mb-4 text-xs text-muted"><Link href="/current-affairs" className="hover:text-ink">Current Affairs</Link> / #{params.slug}</nav>
      <h1 className="font-heading text-3xl font-extrabold sm:text-4xl">#{name}</h1>

      {items.length === 0 ? (
        <p className="mt-10 rounded-xl border border-line bg-surface p-8 text-center text-ink2">No articles with this tag yet.</p>
      ) : (
        <>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {pageItems.map((a) => <CaArticleCard key={a.id} article={a} />)}
          </div>
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3 text-sm">
              {page > 1 && <Link href={`/current-affairs/tag/${params.slug}?page=${page - 1}`} className="btn btn-secondary">← Prev</Link>}
              <span className="text-ink2">Page {page} of {totalPages}</span>
              {page < totalPages && <Link href={`/current-affairs/tag/${params.slug}?page=${page + 1}`} className="btn btn-secondary">Next →</Link>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
