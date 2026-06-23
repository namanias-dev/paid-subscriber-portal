"use client";

import { useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatBytes } from "@/lib/dates";
import type { LibraryDoc } from "@/lib/types";

export default function LibraryAdmin() {
  const { data, loading, reload } = useAdminData<LibraryDoc[]>("/api/admin/library", "docs");
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "library");
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const r = await res.json().catch(() => ({ ok: false }));
    setUploading(false);
    if (r.ok && r.url) {
      setFileUrl(r.url);
      setFileSize(file.size);
      if (!title.trim()) setTitle(file.name.replace(/\.pdf$/i, ""));
      toast("PDF uploaded", "success");
    } else toast(r.error || "Upload failed", "error");
    e.target.value = "";
  }

  async function create() {
    if (!title.trim()) return toast("Title required", "error");
    if (!fileUrl.trim()) return toast("Upload a PDF or paste a URL", "error");
    setCreating(true);
    const res = await fetch("/api/admin/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), category: category.trim() || null, file_url: fileUrl.trim(), file_size: fileSize }),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    setCreating(false);
    if (d.ok) {
      toast("Added to library", "success");
      setTitle(""); setCategory(""); setFileUrl(""); setFileSize(null);
      reload();
    } else toast(d.error || "Failed", "error");
  }

  async function remove(doc: LibraryDoc) {
    const res = await fetch(`/api/admin/library/${doc.id}`, { method: "DELETE" });
    if (res.status === 409) {
      const d = await res.json().catch(() => ({}));
      const where = [...(d.usage?.courses || []), ...(d.usage?.webinars || [])];
      const ok = confirm(
        `"${doc.title}" is used by ${where.length} item(s):\n\n${where.slice(0, 8).join("\n")}${where.length > 8 ? "\n…" : ""}\n\nDelete anyway? Those references will break.`
      );
      if (!ok) return;
      const force = await fetch(`/api/admin/library/${doc.id}?force=1`, { method: "DELETE" });
      if ((await force.json().catch(() => ({}))).ok) { toast("Deleted", "success"); reload(); }
      else toast("Delete failed", "error");
      return;
    }
    if (!confirm(`Delete "${doc.title}"? The shared file will be removed from the library.`)) { reload(); return; }
    const d = await res.json().catch(() => ({ ok: false }));
    if (d.ok) { toast("Deleted", "success"); reload(); }
    else toast("Delete failed", "error");
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Brochure / Resources Library"
        subtitle="Upload a PDF once, then attach it to many courses & webinars — no re-uploading"
      />

      <div className="card mb-6 grid gap-3 p-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Foundation 2026 Brochure" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Category (optional)</span>
          <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Brochure, Syllabus, Notes" />
        </label>
        <div className="flex items-end gap-3 text-sm sm:col-span-2">
          <label className="btn btn-secondary cursor-pointer text-sm">
            {uploading ? "Uploading…" : fileUrl ? "Replace PDF" : "Upload PDF"}
            <input type="file" accept="application/pdf" className="hidden" onChange={onPick} />
          </label>
          {fileUrl && <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary text-xs">View file ↗ {fileSize ? `(${formatBytes(fileSize)})` : ""}</a>}
        </div>
        <input className="input text-xs sm:col-span-2" placeholder="Or paste PDF URL" value={fileUrl} onChange={(e) => { setFileUrl(e.target.value); setFileSize(null); }} />
        <div className="sm:col-span-2">
          <button onClick={create} disabled={creating} className="btn btn-primary text-sm">{creating ? "Saving…" : "Add to library"}</button>
        </div>
      </div>

      <TableShell headers={["Title", "Category", "Size", "Added", "File", ""]}>
        {(data || []).map((d) => (
          <tr key={d.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{d.title}</td>
            <td className="px-4 py-3 text-xs">{d.category || "—"}</td>
            <td className="px-4 py-3 text-xs">{formatBytes(d.file_size) || "—"}</td>
            <td className="px-4 py-3 text-xs">{formatDate(d.created_at)}</td>
            <td className="px-4 py-3 text-xs">{d.file_url ? <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-primary">Open</a> : <span className="text-muted">—</span>}</td>
            <td className="px-4 py-3"><button onClick={() => remove(d)} className="text-danger text-xs">Delete</button></td>
          </tr>
        ))}
        {(data || []).length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink2">No documents yet. Upload your first brochure above.</td></tr>}
      </TableShell>
    </div>
  );
}
