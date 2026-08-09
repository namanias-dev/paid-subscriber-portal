"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/ui/Reveal";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaFilterChips from "@/components/public/ca/CaFilterChips";
import type { CaArticle } from "@/lib/types";

const PER_PAGE = 12;

function matchesFilters(a: CaArticle, type: string, gs: string, rel: string, q: string): boolean {
  if (type && a.article_type !== type) return false;
  if (gs && !(a.upsc?.gs_papers || []).includes(gs as never)) return false;
  if (rel) {
    const er = a.upsc?.exam_relevance;
    if (rel === "prelims" && !(er === "prelims" || er === "both" || (a.upsc?.gs_papers || []).includes("Prelims" as never))) return false;
    if (rel === "mains" && !(er === "mains" || er === "both")) return false;
  }
  if (q) {
    const t = q.toLowerCase();
    if (!`${a.title} ${a.summary} ${(a.tags || []).join(" ")}`.toLowerCase().includes(t)) return false;
  }
  return true;
}

/**
 * URL-driven filter/search/pagination for the CA hub. Lives in a client
 * boundary so the server page can stay ISR (no searchParams on the RSC).
 */
export default function CaHubFilters({ articles }: { articles: CaArticle[] }) {
  const sp = useSearchParams();
  const type = sp.get("type") || "";
  const gs = sp.get("gs") || "";
  const rel = sp.get("rel") || "";
  const q = (sp.get("q") || "").trim();
  const sort = sp.get("sort") || "newest";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const isFiltering = !!(type || gs || rel || q);

  const { sorted, pageItems, totalPages } = useMemo(() => {
    const filtered = articles.filter((a) => matchesFilters(a, type, gs, rel, q));
    const sortedList = sort === "most_read" ? [...filtered].sort((a, b) => b.views - a.views) : filtered;
    return {
      sorted: sortedList,
      pageItems: sortedList.slice((page - 1) * PER_PAGE, page * PER_PAGE),
      totalPages: Math.max(1, Math.ceil(sortedList.length / PER_PAGE)),
    };
  }, [articles, type, gs, rel, q, sort, page]);

  const buildHref = (overrides: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { type, gs, rel, q, sort, ...overrides };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, String(v));
    });
    const s = params.toString();
    return `/current-affairs${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mb-10 space-y-4">
      <CaFilterChips />
      <form action="/current-affairs" className="flex gap-2">
        <div className="relative max-w-md flex-1">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ca-slate-400)]" aria-hidden="true" />
          <input name="q" defaultValue={q} placeholder="Search current affairs…" className="input ca-focus pl-9" />
        </div>
        {type && <input type="hidden" name="type" value={type} />}
        <button className="ca-btn ca-btn-outline ca-focus">Search</button>
      </form>

      {isFiltering && (
        <section>
          <h2 className="mb-6 font-heading text-2xl font-bold tracking-tight text-[var(--ca-navy-900)]">
            {sorted.length} result{sorted.length === 1 ? "" : "s"}
          </h2>
          {pageItems.length === 0 ? (
            <p className="rounded-2xl border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] p-10 text-center text-[var(--ca-slate-700)]">
              No articles match these filters.{" "}
              <Link href="/current-affairs" className="font-semibold text-[var(--ca-navy-600)] underline">
                Clear filters
              </Link>
            </p>
          ) : (
            <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {pageItems.map((a) => (
                <StaggerItem key={a.id} className="h-full">
                  <CaArticleCard article={a} />
                </StaggerItem>
              ))}
            </Stagger>
          )}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3 text-sm">
              {page > 1 && (
                <Link href={buildHref({ page: page - 1 })} className="ca-btn ca-btn-outline ca-focus">
                  ← Prev
                </Link>
              )}
              <span className="text-[var(--ca-slate-700)]">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link href={buildHref({ page: page + 1 })} className="ca-btn ca-btn-outline ca-focus">
                  Next →
                </Link>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** True when the URL has active filters — used to hide the default hub sections. */
export function useCaHubFiltering(): boolean {
  const sp = useSearchParams();
  return !!(sp.get("type") || sp.get("gs") || sp.get("rel") || (sp.get("q") || "").trim());
}
