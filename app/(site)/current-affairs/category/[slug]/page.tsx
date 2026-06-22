import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import { getPublicCaArticles, getCaCategoryBySlug } from "@/lib/dataProvider";
import { DEFAULT_CA_CATEGORIES, caCategoryName } from "@/lib/caConstants";
import { caMetadata } from "@/lib/caView";
import { ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

const PER_PAGE = 18;

function known(slug: string): boolean {
  return DEFAULT_CA_CATEGORIES.some((c) => c.slug === slug);
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const cat = await getCaCategoryBySlug(params.slug);
  if (!cat && !known(params.slug)) return { title: "Category not found" };
  const name = cat?.name || caCategoryName(params.slug);
  return caMetadata({
    title: `${name} — UPSC Current Affairs | ${ACADEMY.shortName}`,
    description: cat?.description || `Latest UPSC current affairs on ${name} for Prelims and Mains.`,
    path: `/current-affairs/category/${params.slug}`,
    seo: cat?.seo,
  });
}

export default async function CategoryPage({ params, searchParams }: { params: { slug: string }; searchParams: Record<string, string | undefined> }) {
  const cat = await getCaCategoryBySlug(params.slug);
  if (!cat && !known(params.slug)) notFound();
  const name = cat?.name || caCategoryName(params.slug);

  const all = await getPublicCaArticles();
  const items = all.filter((a) => a.category_slug === params.slug);
  const page = Math.max(1, Number(searchParams.page) || 1);
  const pageItems = items.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));

  return (
    <div className="container-wide py-10">
      <nav className="mb-4 text-xs text-muted"><Link href="/current-affairs" className="hover:text-ink">Current Affairs</Link> / {name}</nav>
      <h1 className="font-heading text-3xl font-extrabold sm:text-4xl">{name}</h1>
      {cat?.description && <p className="mt-2 max-w-2xl text-ink2">{cat.description}</p>}

      {items.length === 0 ? (
        <p className="mt-10 rounded-xl border border-line bg-surface p-8 text-center text-ink2">No articles in this topic yet. <Link href="/current-affairs" className="text-primary">Back to Current Affairs</Link></p>
      ) : (
        <>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {pageItems.map((a) => <CaArticleCard key={a.id} article={a} />)}
          </div>
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3 text-sm">
              {page > 1 && <Link href={`/current-affairs/category/${params.slug}?page=${page - 1}`} className="btn btn-secondary">← Prev</Link>}
              <span className="text-ink2">Page {page} of {totalPages}</span>
              {page < totalPages && <Link href={`/current-affairs/category/${params.slug}?page=${page + 1}`} className="btn btn-secondary">Next →</Link>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
