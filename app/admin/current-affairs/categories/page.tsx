"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import type { CaCategory } from "@/lib/types";

export default function CaCategoriesAdmin() {
  const { data, loading, reload } = useAdminData<CaCategory[]>("/api/admin/current-affairs/categories", "categories");
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function create() {
    if (!name.trim()) return toast("Name required", "error");
    const res = await fetch("/api/admin/current-affairs/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    if (d.ok) { toast("Category added", "success"); setName(""); setDescription(""); reload(); }
    else toast(d.error || "Failed", "error");
  }

  async function remove(id: string) {
    if (!confirm("Delete category?")) return;
    await fetch(`/api/admin/current-affairs/categories/${id}`, { method: "DELETE" });
    reload();
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Current Affairs — Categories" subtitle="One primary category per article" action={<Link href="/admin/current-affairs" className="btn btn-ghost text-sm">← Articles</Link>} />

      <div className="card mb-5 grid gap-3 p-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Economy" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Description (optional)</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <button onClick={create} className="btn btn-primary text-sm">Add</button>
      </div>

      <TableShell headers={["Name", "Slug", "Description", ""]}>
        {(data || []).map((c) => (
          <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{c.name}</td>
            <td className="px-4 py-3 text-xs text-muted">{c.slug}</td>
            <td className="px-4 py-3 text-xs">{c.description || "—"}</td>
            <td className="px-4 py-3"><button onClick={() => remove(c.id)} className="text-danger text-xs">Delete</button></td>
          </tr>
        ))}
        {(data || []).length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink2">No categories yet.</td></tr>}
      </TableShell>
    </div>
  );
}
