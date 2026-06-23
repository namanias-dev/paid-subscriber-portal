import Link from "next/link";
import { Newspaper, Clock, ArrowUpRight, Star } from "lucide-react";
import { caArticleTypeLabel, caCategoryName } from "@/lib/caConstants";
import { caDateLabel } from "@/lib/caView";
import type { CaArticle } from "@/lib/types";

const TYPE_TONE: Record<string, string> = {
  daily: "text-[var(--ca-navy-600)] bg-[rgba(30,58,138,0.08)] border-[rgba(30,58,138,0.16)]",
  editorial: "text-[#8a6d12] bg-[var(--ca-gold-soft)] border-[rgba(212,175,55,0.35)]",
  prelims_facts: "text-[var(--success)] bg-[#e7f6ec] border-[rgba(22,163,74,0.2)]",
  mains_analysis: "text-[var(--ca-slate-700)] bg-[var(--ca-slate-50)] border-[var(--ca-slate-200)]",
};

function relevanceLabel(article: CaArticle): string | null {
  const rel = article.upsc?.exam_relevance;
  const gs = article.upsc?.gs_papers || [];
  if (rel === "both") return "Prelims + Mains";
  if (rel === "prelims") return "Prelims";
  if (rel === "mains") return "Mains";
  if (gs.includes("Prelims")) return "Prelims";
  if (gs.some((g) => g.startsWith("GS"))) return "Mains";
  return null;
}

export default function CaArticleCard({ article, compact = false }: { article: CaArticle; compact?: boolean }) {
  const img = article.thumbnail_image || article.featured_image;
  const rel = relevanceLabel(article);
  return (
    <Link href={`/current-affairs/${article.slug}`} className="ca-card ca-focus group flex h-full flex-col overflow-hidden">
      <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden bg-[var(--ca-slate-100,#eef2f7)]">
        {img ? (
          // Fixed-ratio box + object-cover prevents layout shift and oversized raw images.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={article.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)]">
            <Newspaper size={36} strokeWidth={1.5} className="text-[var(--ca-gold-bright)] opacity-90" aria-hidden="true" />
          </div>
        )}
        {/* Subtle gradient overlay for legibility + depth */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-black/0 to-black/0" aria-hidden="true" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold backdrop-blur-sm ${TYPE_TONE[article.article_type] || TYPE_TONE.mains_analysis}`}>
            {caArticleTypeLabel(article.article_type)}
          </span>
          {article.important && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(220,38,38,0.2)] bg-[#fdeaea] px-2 py-0.5 text-[11px] font-bold text-[var(--danger)] backdrop-blur-sm">
              <Star size={11} fill="currentColor" /> Important
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          {article.category_slug && (
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ca-gold)]">{caCategoryName(article.category_slug)}</span>
          )}
          {rel && <span className="inline-flex items-center rounded-full bg-[var(--ca-slate-50)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ca-slate-700)]">{rel}</span>}
        </div>
        <h3 className={`font-heading font-bold leading-snug tracking-tight text-[var(--ca-navy-900)] ${compact ? "text-base" : "text-lg"}`}>{article.title}</h3>
        {!compact && article.summary && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--ca-slate-700)]">{article.summary}</p>}
        <div className="mt-auto flex items-center gap-3 pt-4 text-xs text-[var(--ca-slate-400)]">
          <span>{caDateLabel(article.ca_date || article.publish_at)}</span>
          {article.reading_time ? (
            <span className="inline-flex items-center gap-1"><Clock size={12} /> {article.reading_time} min</span>
          ) : null}
          <ArrowUpRight size={16} className="ml-auto text-[var(--ca-slate-300)] transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--ca-gold)]" aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}
