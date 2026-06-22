"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/dates";
import type { CaPdf, CaPdfKind } from "@/lib/types";

const KINDS: CaPdfKind[] = ["daily", "monthly", "general"];

export default function CaPdfsAdmin() {
  const { data, loading, reload } = useAdminData<CaPdf[]>("/api/admin/current-affairs/pdfs", "pdfs");
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CaPdfKind>("monthly");
  const [dateRef, setDateRef] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [requiresLead, setRequiresLead] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "current-affairs/pdfs");
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const r = await res.json().catch(() => ({ ok: false }));
    setUploading(false);
    if (r.ok && r.url) {
      setFileUrl(r.url);
      if (!title.trim()) setTitle(file.name.replace(/\.pdf$/i, ""));
      toast("PDF uploaded", "success");
    } else toast(r.error || "Upload failed", "error");
    e.target.value = "";
  }

  async function create() {
    if (!title.trim()) return toast("Title required", "error");
    setCreating(true);
    const res = await fetch("/api/admin/current-affairs/pdfs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        kind,
        date_ref: dateRef.trim() || null,
        file_url: fileUrl.trim() || null,
        requires_login: requiresLogin,
        requires_lead: requiresLead,
        is_free: !requiresLogin && !requiresLead,
      }),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    setCreating(false);
    if (d.ok) {
      toast("PDF added", "success");
      setTitle(""); setDateRef(""); setFileUrl(""); setRequiresLogin(false); setRequiresLead(false);
      reload();
    } else toast(d.error || "Failed", "error");
  }

  async function remove(id: string) {
    if (!confirm("Delete PDF record?")) return;
    await fetch(`/api/admin/current-affairs/pdfs/${id}`, { method: "DELETE" });
    reload();
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Current Affairs — PDF Library" subtitle="Daily & monthly compilations and notes" action={<Link href="/admin/current-affairs" className="btn btn-ghost text-sm">← Articles</Link>} />

      <div className="card mb-6 grid gap-3 p-4 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. June 2026 Monthly Compilation" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Kind</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as CaPdfKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Date ref</span>
          <input className="input" value={dateRef} onChange={(e) => setDateRef(e.target.value)} placeholder={kind === "monthly" ? "YYYY-MM" : "YYYY-MM-DD"} />
        </label>
        <div className="flex items-end gap-3 text-sm sm:col-span-2">
          <label className="btn btn-secondary cursor-pointer text-sm">
            {uploading ? "Uploading…" : fileUrl ? "Replace PDF" : "Upload PDF"}
            <input type="file" accept="application/pdf" className="hidden" onChange={onPick} />
          </label>
          {fileUrl && <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary text-xs">View uploaded file ↗</a>}
        </div>
        <input className="input text-xs sm:col-span-2" placeholder="Or paste PDF URL" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} />
        <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={requiresLogin} onChange={(e) => setRequiresLogin(e.target.checked)} /> Requires login</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={requiresLead} onChange={(e) => setRequiresLead(e.target.checked)} /> Requires lead (phone)</label>
        </div>
        <div className="sm:col-span-2">
          <button onClick={create} disabled={creating} className="btn btn-primary text-sm">{creating ? "Saving…" : "Add to library"}</button>
        </div>
      </div>

      <TableShell headers={["Title", "Kind", "Date", "Gating", "Downloads", "File", ""]}>
        {(data || []).map((p) => (
          <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{p.title}</td>
            <td className="px-4 py-3 text-xs"><span className="pill pill-gray">{p.kind}</span></td>
            <td className="px-4 py-3 text-xs">{p.date_ref || "—"}</td>
            <td className="px-4 py-3 text-xs">{p.requires_lead ? "Lead" : p.requires_login ? "Login" : "Free"}</td>
            <td className="px-4 py-3 text-xs">{p.download_count}</td>
            <td className="px-4 py-3 text-xs">{p.file_url ? <a href={p.file_url} target="_blank" rel="noopener noreferrer" className="text-primary">Open</a> : <span className="text-muted">No file</span>}</td>
            <td className="px-4 py-3"><button onClick={() => remove(p.id)} className="text-danger text-xs">Delete</button></td>
          </tr>
        ))}
        {(data || []).length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ink2">No PDFs yet.</td></tr>}
      </TableShell>
    </div>
  );
}
