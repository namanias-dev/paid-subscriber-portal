"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import type { CaTag } from "@/lib/types";

export default function CaTagsAdmin() {
  const { data, loading, reload } = useAdminData<CaTag[]>("/api/admin/current-affairs/tags", "tags");
  const { toast } = useToast();
  const [name, setName] = useState("");

  async function create() {
    if (!name.trim()) return toast("Name required", "error");
    const res = await fetch("/api/admin/current-affairs/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    if (d.ok) { toast("Tag added", "success"); setName(""); reload(); }
    else toast(d.error || "Failed", "error");
  }

  async function remove(id: string) {
    if (!confirm("Delete tag?")) return;
    await fetch(`/api/admin/current-affairs/tags/${id}`, { method: "DELETE" });
    reload();
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Current Affairs — Tags" subtitle="Cross-cutting topics for tag pages" action={<Link href="/admin/current-affairs" className="btn btn-ghost text-sm">← Articles</Link>} />

      <div className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Supreme Court" />
        </label>
        <button onClick={create} className="btn btn-primary text-sm">Add</button>
      </div>

      <TableShell headers={["Name", "Slug", ""]}>
        {(data || []).map((t) => (
          <tr key={t.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{t.name}</td>
            <td className="px-4 py-3 text-xs text-muted">{t.slug}</td>
            <td className="px-4 py-3"><button onClick={() => remove(t.id)} className="text-danger text-xs">Delete</button></td>
          </tr>
        ))}
        {(data || []).length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-ink2">No tags yet.</td></tr>}
      </TableShell>
    </div>
  );
}
