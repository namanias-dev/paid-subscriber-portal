import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaPageHeader from "@/components/public/ca/CaPageHeader";
import { categoryIcon } from "@/components/public/ca/CaIcons";
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
    <div>
      <CaPageHeader
        eyebrow="Topic"
        title={name}
        subtitle={cat?.description || `Latest UPSC current affairs on ${name} for Prelims and Mains.`}
        icon={categoryIcon(params.slug)}
        crumbs={[{ label: "Current Affairs", href: "/current-affairs" }, { label: name }]}
      />
      <div className="container-wide py-12">
        {items.length === 0 ? (
          <p className="rounded-2xl border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] p-10 text-center text-[var(--ca-slate-700)]">No articles in this topic yet. <Link href="/current-affairs" className="font-semibold text-[var(--ca-navy-600)] underline">Back to Current Affairs</Link></p>
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {pageItems.map((a) => <CaArticleCard key={a.id} article={a} />)}
            </div>
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-3 text-sm">
                {page > 1 && <Link href={`/current-affairs/category/${params.slug}?page=${page - 1}`} className="ca-btn ca-btn-outline ca-focus">← Prev</Link>}
                <span className="text-[var(--ca-slate-700)]">Page {page} of {totalPages}</span>
                {page < totalPages && <Link href={`/current-affairs/category/${params.slug}?page=${page + 1}`} className="ca-btn ca-btn-outline ca-focus">Next →</Link>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
