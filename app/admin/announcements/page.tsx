"use client";

import { useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/dates";
import type { Announcement } from "@/lib/types";

export default function AnnouncementsAdmin() {
  const { data, loading, reload } = useAdminData<Announcement[]>("/api/admin/announcements", "announcements");
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [href, setHref] = useState("");
  const [badge, setBadge] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [pinned, setPinned] = useState(true);
  const [sortOrder, setSortOrder] = useState("0");
  const [saving, setSaving] = useState(false);

  function toIso(local: string): string | null {
    if (!local) return null;
    const t = new Date(local);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  }

  async function create() {
    if (!title.trim()) return toast("Title required", "error");
    setSaving(true);
    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        href: href.trim() || null,
        badge: badge.trim() || null,
        pinned,
        active: true,
        sort_order: Number(sortOrder) || 0,
        starts_at: toIso(startsAt),
        ends_at: toIso(endsAt),
      }),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (d.ok) {
      toast("Announcement added", "success");
      setTitle(""); setHref(""); setBadge(""); setStartsAt(""); setEndsAt(""); setSortOrder("0"); setPinned(true);
      reload();
    } else toast(d.error || "Failed", "error");
  }

  async function patch(id: string, body: Partial<Announcement>) {
    await fetch(`/api/admin/announcements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    reload();
  }

  async function remove(id: string) {
    if (!confirm("Delete this announcement?")) return;
    await fetch(`/api/admin/announcements/${id}`, { method: "DELETE" });
    reload();
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Announcements"
        subtitle="Pin manual items to the homepage “What's New” bar & section. Auto items (open webinars, batches, new guides & PDFs) always appear alongside these."
      />

      <div className="card mb-6 grid gap-3 p-4 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New Foundation Batch 2027 — enrolments open" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Link (href)</span>
          <input className="input" value={href} onChange={(e) => setHref(e.target.value)} placeholder="/courses/foundation-2027 or https://…" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Badge (short label)</span>
          <input className="input" value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="New" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Starts at (optional)</span>
          <input type="datetime-local" className="input" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Ends at (optional)</span>
          <input type="datetime-local" className="input" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Sort order</span>
          <input type="number" className="input" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </label>
        <label className="flex items-end gap-2 text-sm">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Show in top rotating bar
        </label>
        <div className="sm:col-span-2">
          <button onClick={create} disabled={saving} className="btn btn-primary text-sm">{saving ? "Saving…" : "Add announcement"}</button>
        </div>
      </div>

      <TableShell headers={["Title", "Link", "Badge", "Window", "Bar", "Active", ""]}>
        {(data || []).map((a) => (
          <tr key={a.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{a.title}</td>
            <td className="px-4 py-3 text-xs">{a.href ? <a href={a.href} target="_blank" rel="noopener noreferrer" className="text-primary">Open</a> : <span className="text-muted">—</span>}</td>
            <td className="px-4 py-3 text-xs">{a.badge || "—"}</td>
            <td className="px-4 py-3 text-xs">
              {a.starts_at ? formatDate(a.starts_at) : "now"} → {a.ends_at ? formatDate(a.ends_at) : "∞"}
            </td>
            <td className="px-4 py-3 text-xs">
              <button onClick={() => patch(a.id, { pinned: !a.pinned })} className={`pill ${a.pinned ? "pill-blue" : "pill-gray"}`}>{a.pinned ? "Bar" : "Section"}</button>
            </td>
            <td className="px-4 py-3 text-xs">
              <button onClick={() => patch(a.id, { active: !a.active })} className={`pill ${a.active ? "pill-green" : "pill-gray"}`}>{a.active ? "Active" : "Off"}</button>
            </td>
            <td className="px-4 py-3"><button onClick={() => remove(a.id)} className="text-danger text-xs">Delete</button></td>
          </tr>
        ))}
        {(data || []).length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ink2">No manual announcements. Auto “What's New” items still appear on the homepage.</td></tr>}
      </TableShell>
    </div>
  );
}
