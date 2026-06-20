"use client";

import { useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CONTENT_META } from "@/lib/contentMeta";
import { SUBJECTS } from "@/lib/config";
import { formatDate } from "@/lib/dates";
import type { ContentItem, ContentType } from "@/lib/types";

const TYPES = Object.keys(CONTENT_META) as ContentType[];

export default function ContentAdmin() {
  const { data: content, loading, reload } = useAdminData<ContentItem[]>("/api/admin/content", "content");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "current_affairs" as ContentType, title: "", subject: "", paper: "", description: "", drive_link: "", youtube_link: "", duration: "", is_published: true, drip_date: "" });

  async function create() {
    if (!form.title) { toast("Title required", "error"); return; }
    await fetch("/api/admin/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    toast("Content added", "success");
    setForm({ ...form, title: "", description: "", drive_link: "", youtube_link: "", duration: "" });
    setOpen(false);
    reload();
  }

  async function togglePublish(item: ContentItem) {
    await fetch(`/api/admin/content/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_published: !item.is_published }) });
    reload();
  }

  async function remove(id: string) {
    if (!confirm("Delete content?")) return;
    await fetch(`/api/admin/content/${id}`, { method: "DELETE" });
    reload();
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Content / LMS Manager" subtitle="CA, MCQs, booklets, PYQs, recordings, tests, notes, maps" action={<button onClick={() => setOpen(true)} className="btn btn-primary text-sm">+ Add Content</button>} />

      <TableShell headers={["Title", "Type", "Subject", "Date", "Published", ""]}>
        {(content || []).map((c) => (
          <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{CONTENT_META[c.type].icon} {c.title}</td>
            <td className="px-4 py-3 text-xs">{CONTENT_META[c.type].label}</td>
            <td className="px-4 py-3">{c.subject || "—"}</td>
            <td className="px-4 py-3">{formatDate(c.date)}</td>
            <td className="px-4 py-3">
              <button onClick={() => togglePublish(c)} className={`pill ${c.is_published ? "pill-green" : "pill-gray"}`}>{c.is_published ? "Live" : "Draft"}</button>
            </td>
            <td className="px-4 py-3"><button onClick={() => remove(c.id)} className="text-danger text-xs">Delete</button></td>
          </tr>
        ))}
      </TableShell>

      <Modal open={open} onClose={() => setOpen(false)} title="Add Content" maxWidth="max-w-lg">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ContentType })}>
              {TYPES.map((t) => <option key={t} value={t}>{CONTENT_META[t].label}</option>)}
            </select>
            <select className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
              <option value="">Subject</option>
              {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea className="input" rows={2} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <input className="input" placeholder="Paper (e.g. GS2)" value={form.paper} onChange={(e) => setForm({ ...form, paper: e.target.value })} />
            <input className="input" placeholder="Duration" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
          </div>
          <input className="input" placeholder="Drive link" value={form.drive_link} onChange={(e) => setForm({ ...form, drive_link: e.target.value })} />
          <input className="input" placeholder="YouTube link" value={form.youtube_link} onChange={(e) => setForm({ ...form, youtube_link: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Drip release date</label><input type="date" className="input" value={form.drip_date} onChange={(e) => setForm({ ...form, drip_date: e.target.value })} /></div>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} /> Publish now</label>
          </div>
          <button onClick={create} className="btn btn-primary w-full">Add Content</button>
        </div>
      </Modal>
    </div>
  );
}
