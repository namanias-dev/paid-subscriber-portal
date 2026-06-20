"use client";

import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/lib/dates";
import type { Course } from "@/lib/types";

export default function CoursesAdmin() {
  const { data: courses, loading, reload } = useAdminData<Course[]>("/api/admin/courses", "courses");
  const { toast } = useToast();

  async function remove(id: string) {
    if (!confirm("Delete this course?")) return;
    await fetch(`/api/admin/courses/${id}`, { method: "DELETE" });
    toast("Deleted", "success");
    reload();
  }

  async function toggleActive(c: Course) {
    const next = c.active === false;
    await fetch(`/api/admin/courses/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: next }),
    });
    toast(next ? "Course enabled" : "Course disabled — hidden from public", "success");
    reload();
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Course Manager"
        subtitle="Create products — they auto-generate public course & checkout pages"
        action={<Link href="/admin/courses/new" className="btn btn-primary text-sm">+ New Course</Link>}
      />

      <TableShell headers={["Title", "Category", "Mode", "Price", "Status", "Public", ""]}>
        {(courses || []).map((c) => (
          <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{c.title}</td>
            <td className="px-4 py-3">{c.category}</td>
            <td className="px-4 py-3 text-xs">{c.modes.join(", ")}</td>
            <td className="px-4 py-3">{c.price === 0 ? "Free" : formatINR(c.price)}</td>
            <td className="px-4 py-3">
              {c.active === false ? (
                <span className="pill pill-gray">Disabled</span>
              ) : (
                <span className={`pill ${c.status === "published" ? "pill-green" : c.status === "draft" ? "pill-amber" : "pill-gray"}`}>{c.status}</span>
              )}
            </td>
            <td className="px-4 py-3"><a href={`/courses/${c.slug}`} target="_blank" rel="noopener noreferrer" className="text-primary text-xs">View ↗</a></td>
            <td className="px-4 py-3">
              <div className="flex gap-2">
                <Link href={`/admin/courses/${c.id}/edit`} className="text-primary text-xs">Edit</Link>
                <button onClick={() => toggleActive(c)} className="text-xs text-ink2">{c.active === false ? "Enable" : "Disable"}</button>
                <button onClick={() => remove(c.id)} className="text-danger text-xs">Delete</button>
              </div>
            </td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}
