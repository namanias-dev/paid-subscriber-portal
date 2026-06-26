"use client";

import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatINR, formatISTDateTime } from "@/lib/dates";
import type { Webinar } from "@/lib/types";

export default function WebinarsAdmin() {
  const { data: webinars, loading, reload } = useAdminData<Webinar[]>("/api/admin/webinars", "webinars");
  const { toast } = useToast();

  async function remove(id: string) {
    if (!confirm("Delete webinar?")) return;
    await fetch(`/api/admin/webinars/${id}`, { method: "DELETE" });
    reload();
  }

  async function toggleActive(w: Webinar) {
    const next = w.active === false;
    await fetch(`/api/admin/webinars/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: next }),
    });
    toast(next ? "Webinar enabled — now public" : "Webinar disabled — hidden from public", "success");
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
      <PageHeader
        title="Webinars & Events"
        subtitle="Each webinar auto-creates a public registration page"
        action={<Link href="/admin/webinars/new" className="btn btn-primary text-sm">+ New Webinar</Link>}
      />

      <TableShell headers={["Title", "When", "Price", "Regs", "Status", "Share", ""]}>
        {(webinars || []).map((w) => (
          <tr key={w.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{w.title}</td>
            <td className="px-4 py-3">{formatISTDateTime(w.datetime)}</td>
            <td className="px-4 py-3">{w.price === 0 ? "Free" : formatINR(w.price)}</td>
            <td className="px-4 py-3">
              <Link href={`/admin/webinars/${w.id}/registrations`} className="text-primary hover:underline">
                View registrants
              </Link>
            </td>
            <td className="px-4 py-3">
              {w.active === false ? (
                <span className="pill pill-gray">Disabled</span>
              ) : (
                <span className={`pill ${w.status === "completed" ? "pill-gray" : "pill-green"}`}>{w.status}</span>
              )}
            </td>
            <td className="px-4 py-3">
              <div className="flex gap-2 text-xs">
                <button onClick={() => copyLink(w.slug)} className="text-primary">Copy link</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(`Register: ${typeof window !== "undefined" ? window.location.origin : ""}/webinars/${w.slug}`)}`} target="_blank" rel="noopener noreferrer" className="text-primary">WhatsApp</a>
              </div>
            </td>
            <td className="px-4 py-3">
              <div className="flex gap-2">
                <Link href={`/admin/webinars/${w.id}/edit`} className="text-primary text-xs">Edit</Link>
                <button onClick={() => toggleActive(w)} className="text-xs text-ink2">{w.active === false ? "Enable" : "Disable"}</button>
                <button onClick={() => remove(w.id)} className="text-danger text-xs">Delete</button>
              </div>
            </td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}
