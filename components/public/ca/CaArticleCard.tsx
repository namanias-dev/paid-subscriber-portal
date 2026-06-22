import Link from "next/link";
import { caArticleTypeLabel, caCategoryName } from "@/lib/caConstants";
import { caDateLabel } from "@/lib/caView";
import type { CaArticle } from "@/lib/types";

const TYPE_PILL: Record<string, string> = {
  daily: "pill-blue",
  editorial: "pill-amber",
  prelims_facts: "pill-green",
  mains_analysis: "pill-gray",
};

export default function CaArticleCard({ article, compact = false }: { article: CaArticle; compact?: boolean }) {
  const img = article.thumbnail_image || article.featured_image;
  return (
    <Link
      href={`/current-affairs/${article.slug}`}
      className="card group flex h-full flex-col overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-[var(--gold-soft)]">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={article.title} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--navy)] to-[#13306e] text-3xl text-white/90">
            📰
          </div>
        )}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className={`pill ${TYPE_PILL[article.article_type] || "pill-gray"} text-[11px]`}>{caArticleTypeLabel(article.article_type)}</span>
          {article.important && <span className="pill pill-red text-[11px]">Important</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        {article.category_slug && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--gold)]">{caCategoryName(article.category_slug)}</p>
        )}
        <h3 className={`font-heading font-bold leading-snug text-ink ${compact ? "text-base" : "text-lg"}`}>{article.title}</h3>
        {!compact && article.summary && <p className="mt-2 line-clamp-2 text-sm text-ink2">{article.summary}</p>}
        <div className="mt-auto flex items-center gap-3 pt-3 text-xs text-muted">
          <span>{caDateLabel(article.ca_date || article.publish_at)}</span>
          {article.reading_time ? <span>· {article.reading_time} min read</span> : null}
        </div>
      </div>
    </Link>
  );
}
