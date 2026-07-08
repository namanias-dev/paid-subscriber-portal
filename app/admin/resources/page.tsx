"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/dates";
import { resourceCategoryName, RESOURCE_STATUSES, RESOURCE_CATEGORIES } from "@/lib/resourceConstants";
import type { Resource } from "@/lib/types";

const STATUS_PILL: Record<string, string> = {
  published: "pill-green",
  scheduled: "pill-amber",
  draft: "pill-gray",
  archived: "pill-gray",
};

const TABS = [
  { id: "", label: "All" },
  { id: "published", label: "Published" },
  { id: "draft", label: "Drafts" },
  { id: "scheduled", label: "Scheduled" },
  { id: "archived", label: "Archived" },
  { id: "journey", label: "Journey" },
];

export default function ResourcesAdmin() {
  const { data: resources, loading, reload } = useAdminData<Resource[]>("/api/admin/resources", "resources");
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (resources || [])
      .filter((r) => {
        if (tab === "journey") { if (!(r.journey_stage || "").trim()) return false; }
        else if (tab && r.status !== tab) return false;
        if (category && r.category !== category) return false;
        if (term && !(`${r.title} ${r.slug} ${r.focus_keyword || ""}`.toLowerCase().includes(term))) return false;
        return true;
      })
      .sort((a, b) => (a.order_index ?? 9999) - (b.order_index ?? 9999));
  }, [resources, q, tab, category]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/admin/resources/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  async function bulk(body: Record<string, unknown>, label: string) {
    if (selected.size === 0) return toast("Select at least one resource.", "error");
    await Promise.all(Array.from(selected).map((id) => patch(id, body)));
    toast(`${selected.size} resource(s) ${label}.`, "success");
    setSelected(new Set());
    reload();
  }

  async function remove(id: string) {
    if (!confirm("Delete resource?")) return;
    await fetch(`/api/admin/resources/${id}`, { method: "DELETE" });
    reload();
  }

  async function duplicate(r: Resource) {
    const copy = { ...r, title: `${r.title} (copy)`, slug: `${r.slug}-copy-${Date.now().toString(36).slice(-4)}`, status: "draft" };
    delete (copy as Partial<Resource>).id;
    const res = await fetch("/api/admin/resources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(copy) });
    const d = await res.json().catch(() => ({ ok: false }));
    if (d.ok) { toast("Duplicated as draft.", "success"); reload(); }
    else toast(d.error || "Failed to duplicate", "error");
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="UPSC Resources"
        subtitle="Evergreen SEO guides, strategy, booklists & local pages — the Day-1→Exam content hub"
        action={<Link href="/admin/resources/new" className="btn btn-primary text-sm">+ New Resource</Link>}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${tab === t.id ? "bg-primary text-white" : "bg-surface2 text-ink2 hover:bg-surface"}`}>{t.label}</button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search title / slug / keyword" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input max-w-[200px]" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {RESOURCE_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <div className="ml-auto flex gap-2 text-sm">
          <Link href="/resources" target="_blank" className="btn btn-ghost text-xs">View hub ↗</Link>
          <Link href="/admin/current-affairs" className="btn btn-ghost text-xs">Current Affairs</Link>
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

      <TableShell headers={["", "#", "Title", "Category", "Stage", "Updated", "Views", "Status", ""]}>
        {filtered.map((r) => (
          <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
            <td className="px-4 py-3 text-xs text-ink2">{r.order_index || "—"}</td>
            <td className="px-4 py-3 font-medium">{r.title}{r.is_local && <span className="pill pill-gray ml-2 text-[10px]">local</span>}</td>
            <td className="px-4 py-3 text-xs">{resourceCategoryName(r.category)}</td>
            <td className="px-4 py-3 text-xs">{r.journey_stage ? r.journey_stage.replace(/^Stage \d+: /, "") : "—"}</td>
            <td className="px-4 py-3 text-xs">{r.updated_at ? formatDate(r.updated_at) : "—"}</td>
            <td className="px-4 py-3 text-xs">{r.views}</td>
            <td className="px-4 py-3"><span className={`pill ${STATUS_PILL[r.status] || "pill-gray"}`}>{r.status}</span></td>
            <td className="px-4 py-3">
              <div className="flex gap-2 text-xs">
                <Link href={`/admin/resources/${r.id}/edit`} className="text-primary">Edit</Link>
                <a href={`/resources/${r.slug}?preview=1`} target="_blank" rel="noopener noreferrer" className="text-ink2">Preview</a>
                <button onClick={() => duplicate(r)} className="text-ink2">Duplicate</button>
                <button onClick={() => remove(r.id)} className="text-danger">Delete</button>
              </div>
            </td>
          </tr>
        ))}
        {filtered.length === 0 && (
          <tr><td colSpan={9} className="px-4 py-10 text-center text-ink2">No resources match.</td></tr>
        )}
      </TableShell>
    </div>
  );
}
