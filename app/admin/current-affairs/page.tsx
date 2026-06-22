"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/dates";
import { caCategoryName, caArticleTypeLabel, CA_STATUSES } from "@/lib/caConstants";
import type { CaArticle } from "@/lib/types";

const STATUS_PILL: Record<string, string> = {
  published: "pill-green",
  scheduled: "pill-amber",
  draft: "pill-gray",
  archived: "pill-gray",
  disabled: "pill-red",
};

export default function CaArticlesAdmin() {
  const { data: articles, loading, reload } = useAdminData<CaArticle[]>("/api/admin/current-affairs", "articles");
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const categories = useMemo(() => {
    const s = new Set<string>();
    (articles || []).forEach((a) => a.category_slug && s.add(a.category_slug));
    return Array.from(s);
  }, [articles]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (articles || []).filter((a) => {
      if (status && a.status !== status) return false;
      if (category && a.category_slug !== category) return false;
      if (term && !(`${a.title} ${a.slug} ${a.author || ""}`.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [articles, q, status, category]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/admin/current-affairs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function bulk(body: Record<string, unknown>, label: string) {
    if (selected.size === 0) return toast("Select at least one article.", "error");
    await Promise.all(Array.from(selected).map((id) => patch(id, body)));
    toast(`${selected.size} article(s) ${label}.`, "success");
    setSelected(new Set());
    reload();
  }

  async function remove(id: string) {
    if (!confirm("Delete article?")) return;
    await fetch(`/api/admin/current-affairs/${id}`, { method: "DELETE" });
    reload();
  }

  async function duplicate(a: CaArticle) {
    const copy = {
      ...a,
      title: `${a.title} (copy)`,
      slug: `${a.slug}-copy-${Date.now().toString(36).slice(-4)}`,
      status: "draft",
    };
    delete (copy as Partial<CaArticle>).id;
    const res = await fetch("/api/admin/current-affairs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(copy),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    if (d.ok) { toast("Duplicated as draft.", "success"); reload(); }
    else toast(d.error || "Failed to duplicate", "error");
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Current Affairs — Articles"
        subtitle="Daily articles, editorials and analysis"
        action={<Link href="/admin/current-affairs/new" className="btn btn-primary text-sm">+ New Article</Link>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search title / slug / author" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input max-w-[160px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {CA_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input max-w-[200px]" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{caCategoryName(c)}</option>)}
        </select>
        <div className="ml-auto flex gap-2 text-sm">
          <Link href="/admin/current-affairs/categories" className="btn btn-ghost text-xs">Categories</Link>
          <Link href="/admin/current-affairs/tags" className="btn btn-ghost text-xs">Tags</Link>
          <Link href="/admin/current-affairs/pdfs" className="btn btn-ghost text-xs">PDF Library</Link>
          <Link href="/admin/current-affairs/daily" className="btn btn-ghost text-xs">Daily</Link>
          <Link href="/admin/current-affairs/analytics" className="btn btn-ghost text-xs">Analytics</Link>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <button onClick={() => bulk({ status: "published", publish_at: new Date().toISOString() }, "published")} className="btn btn-secondary text-xs">Publish</button>
          <button onClick={() => bulk({ status: "archived" }, "archived")} className="btn btn-secondary text-xs">Archive</button>
          <button onClick={() => bulk({ status: "draft" }, "set to draft")} className="btn btn-secondary text-xs">Unpublish</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-ink2">Clear</button>
        </div>
      )}

      <TableShell headers={["", "Title", "Type", "Category", "Date", "Views", "Status", ""]}>
        {filtered.map((a) => (
          <tr key={a.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3"><input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} /></td>
            <td className="px-4 py-3 font-medium">{a.title}</td>
            <td className="px-4 py-3 text-xs">{caArticleTypeLabel(a.article_type)}</td>
            <td className="px-4 py-3 text-xs">{caCategoryName(a.category_slug)}</td>
            <td className="px-4 py-3 text-xs">{a.ca_date ? formatDate(a.ca_date) : "—"}</td>
            <td className="px-4 py-3 text-xs">{a.views}</td>
            <td className="px-4 py-3"><span className={`pill ${STATUS_PILL[a.status] || "pill-gray"}`}>{a.status}</span></td>
            <td className="px-4 py-3">
              <div className="flex gap-2 text-xs">
                <Link href={`/admin/current-affairs/${a.id}/edit`} className="text-primary">Edit</Link>
                <a href={`/current-affairs/${a.slug}?preview=1`} target="_blank" rel="noopener noreferrer" className="text-ink2">Preview</a>
                <button onClick={() => duplicate(a)} className="text-ink2">Duplicate</button>
                <button onClick={() => remove(a.id)} className="text-danger">Delete</button>
              </div>
            </td>
          </tr>
        ))}
        {filtered.length === 0 && (
          <tr><td colSpan={8} className="px-4 py-10 text-center text-ink2">No articles match.</td></tr>
        )}
      </TableShell>
    </div>
  );
}
