"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock } from "@/components/admin/ui";
import { formatDate } from "@/lib/dates";
import type { CaArticle } from "@/lib/types";

export default function CaDailyAdmin() {
  const { data, loading } = useAdminData<CaArticle[]>("/api/admin/current-affairs", "articles");

  const grouped = useMemo(() => {
    const map = new Map<string, CaArticle[]>();
    (data || []).forEach((a) => {
      const key = a.ca_date || "Undated";
      const arr = map.get(key) || [];
      arr.push(a);
      map.set(key, arr);
    });
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [data]);

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Current Affairs — Daily Publishing" subtitle="Articles grouped by current-affairs date" action={<Link href="/admin/current-affairs/new" className="btn btn-primary text-sm">+ New Article</Link>} />

      {grouped.length === 0 && <p className="text-ink2">No articles yet.</p>}

      <div className="space-y-5">
        {grouped.map(([date, items]) => {
          const published = items.filter((a) => a.status === "published").length;
          return (
            <div key={date} className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-heading text-lg font-bold">{date === "Undated" ? "Undated" : formatDate(date)}</h2>
                <span className="text-xs text-ink2">{published}/{items.length} published</span>
              </div>
              <div className="space-y-2">
                {items.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-xl border border-line p-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{a.title}</p>
                      <p className="text-xs text-muted">{a.article_type} · {a.status}</p>
                    </div>
                    <div className="flex shrink-0 gap-3 text-xs">
                      <Link href={`/admin/current-affairs/${a.id}/edit`} className="text-primary">Edit</Link>
                      <a href={`/current-affairs/${a.slug}?preview=1`} target="_blank" rel="noopener noreferrer" className="text-ink2">Preview</a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
