"use client";

import { useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatINR, formatDate } from "@/lib/dates";
import type { Webinar } from "@/lib/types";

export default function WebinarsAdmin() {
  const { data: webinars, loading, reload } = useAdminData<Webinar[]>("/api/admin/webinars", "webinars");
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", datetime: "", price: 0, link: "" });

  async function create() {
    if (!form.title) { toast("Title required", "error"); return; }
    await fetch("/api/admin/webinars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, datetime: form.datetime ? new Date(form.datetime).toISOString() : new Date().toISOString() }),
    });
    toast("Webinar created — registration page generated", "success");
    setForm({ title: "", description: "", datetime: "", price: 0, link: "" });
    setAddOpen(false);
    reload();
  }

  async function remove(id: string) {
    if (!confirm("Delete webinar?")) return;
    await fetch(`/api/admin/webinars/${id}`, { method: "DELETE" });
    reload();
  }

  function copyLink(slug: string) {
    const url = `${window.location.origin}/webinars/${slug}`;
    navigator.clipboard.writeText(url);
    toast("Registration link copied", "success");
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Webinars & Events" subtitle="Each webinar auto-creates a public registration page" action={<button onClick={() => setAddOpen(true)} className="btn btn-primary text-sm">+ New Webinar</button>} />

      <TableShell headers={["Title", "When", "Price", "Regs", "Status", "Share", ""]}>
        {(webinars || []).map((w) => (
          <tr key={w.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{w.title}</td>
            <td className="px-4 py-3">{formatDate(w.datetime)}</td>
            <td className="px-4 py-3">{w.price === 0 ? "Free" : formatINR(w.price)}</td>
            <td className="px-4 py-3">{w.registrations}</td>
            <td className="px-4 py-3"><span className={`pill ${w.status === "completed" ? "pill-gray" : "pill-green"}`}>{w.status}</span></td>
            <td className="px-4 py-3">
              <div className="flex gap-2 text-xs">
                <button onClick={() => copyLink(w.slug)} className="text-primary">Copy link</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(`Register: ${typeof window !== "undefined" ? window.location.origin : ""}/webinars/${w.slug}`)}`} target="_blank" rel="noopener noreferrer" className="text-primary">WhatsApp</a>
              </div>
            </td>
            <td className="px-4 py-3"><button onClick={() => remove(w.id)} className="text-danger text-xs">Delete</button></td>
          </tr>
        ))}
      </TableShell>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New Webinar / Event">
        <div className="space-y-3">
          <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea className="input" rows={2} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Date & time</label><input type="datetime-local" className="input" value={form.datetime} onChange={(e) => setForm({ ...form, datetime: e.target.value })} /></div>
            <div><label className="label">Price (₹)</label><input type="number" className="input" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></div>
          </div>
          <input className="input" placeholder="Zoom / YouTube link" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
          <button onClick={create} className="btn btn-primary w-full">Create & Generate Page</button>
        </div>
      </Modal>
    </div>
  );
}
