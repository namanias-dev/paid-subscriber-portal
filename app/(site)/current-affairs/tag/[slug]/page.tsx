import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Hash } from "lucide-react";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaPageHeader from "@/components/public/ca/CaPageHeader";
import { getPublicCaArticles, getCaTagBySlug } from "@/lib/dataProvider";
import { caMetadata } from "@/lib/caView";
import { ACADEMY } from "@/lib/config";

export const revalidate = 600;

export async function generateStaticParams() {
  const all = await getPublicCaArticles();
  const tags = new Set<string>();
  for (const a of all) for (const tag of a.tags || []) if (tag) tags.add(tag);
  return Array.from(tags).map((slug) => ({ slug }));
}

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

export default async function TagPage({ params }: { params: { slug: string } }) {
  const all = await getPublicCaArticles();
  const items = all.filter((a) => (a.tags || []).includes(params.slug));
  const tag = await getCaTagBySlug(params.slug);
  if (items.length === 0 && !tag) notFound();
  const name = tag?.name || titleize(params.slug);

  return (
    <div>
      <CaPageHeader
        eyebrow="Tag"
        title={`#${name}`}
        icon={Hash}
        crumbs={[{ label: "Current Affairs", href: "/current-affairs" }, { label: `#${params.slug}` }]}
      />
      <div className="container-wide py-12">
        {items.length === 0 ? (
          <p className="rounded-2xl border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] p-10 text-center text-[var(--ca-slate-700)]">No articles with this tag yet.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => <CaArticleCard key={a.id} article={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}
