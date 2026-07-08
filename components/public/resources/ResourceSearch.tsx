"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ArrowRight } from "lucide-react";
import { resourceCategoryName } from "@/lib/resourceConstants";

interface Item { slug: string; title: string; summary: string; category: string | null; tags: string[] }

export default function ResourceSearch({ items }: { items: Item[] }) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!term) return [];
    return items
      .filter((r) => `${r.title} ${r.summary} ${(r.tags || []).join(" ")} ${resourceCategoryName(r.category)}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [items, term]);

  return (
    <div className="relative mx-auto max-w-2xl">
      <div className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-3 backdrop-blur">
        <Search size={18} className="text-white/70" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search guides — e.g. NCERT, prelims strategy, booklist…"
          className="w-full bg-transparent text-sm text-white placeholder:text-white/60 focus:outline-none"
          aria-label="Search resources"
        />
      </div>
      {term && (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-[var(--ca-slate-200)] bg-white shadow-xl">
          {results.length === 0 ? (
            <p className="px-4 py-4 text-sm text-[var(--ca-slate-400)]">No guides match “{q}”.</p>
          ) : (
            results.map((r) => (
              <Link key={r.slug} href={`/resources/${r.slug}`} className="flex items-center gap-3 border-b border-[var(--ca-slate-100)] px-4 py-3 text-left transition last:border-0 hover:bg-[var(--ca-slate-50)]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--ca-navy-900)]">{r.title}</p>
                  <p className="truncate text-xs text-[var(--ca-slate-400)]">{resourceCategoryName(r.category)}</p>
                </div>
                <ArrowRight size={15} className="text-[var(--ca-slate-300)]" />
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
