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

export const revalidate = 600;

export async function generateStaticParams() {
  return DEFAULT_CA_CATEGORIES.map((c) => ({ slug: c.slug }));
}

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

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const cat = await getCaCategoryBySlug(params.slug);
  if (!cat && !known(params.slug)) notFound();
  const name = cat?.name || caCategoryName(params.slug);

  const all = await getPublicCaArticles();
  const items = all.filter((a) => a.category_slug === params.slug);

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
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => <CaArticleCard key={a.id} article={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}
