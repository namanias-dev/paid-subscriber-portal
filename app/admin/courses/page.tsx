"use client";

import { useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/lib/dates";
import { COURSE_CATEGORIES, LEARNING_MODES } from "@/lib/config";
import type { Course, CourseCategory, LearningMode } from "@/lib/types";

const EMPTY: Partial<Course> = {
  title: "", category: "Foundation", description: "", modes: ["Online"], price: 0, original_price: null,
  language: "Hinglish (Bilingual)", target_years: "2026/27", duration: "12 months", faculty: "Naman Sir",
  status: "draft", emi_amount: null, emi_months: null, brochure_link: "", demo_video: "", razorpay_link: "",
  featured: false, included: [], not_included: [],
};

export default function CoursesAdmin() {
  const { data: courses, loading, reload } = useAdminData<Course[]>("/api/admin/courses", "courses");
  const { toast } = useToast();
  const [editing, setEditing] = useState<Partial<Course> | null>(null);

  async function save(c: Partial<Course>) {
    const isNew = !c.id;
    const res = await fetch(isNew ? "/api/admin/courses" : `/api/admin/courses/${c.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    });
    const data = await res.json();
    if (data.ok) {
      toast(isNew ? "Course created" : "Course updated", "success");
      setEditing(null);
      reload();
    } else toast(data.error || "Failed", "error");
  }

  async function remove(id: string) {
    if (!confirm("Delete this course?")) return;
    await fetch(`/api/admin/courses/${id}`, { method: "DELETE" });
    toast("Deleted", "success");
    reload();
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Course Manager"
        subtitle="Create products — they auto-generate public course & checkout pages"
        action={<button onClick={() => setEditing({ ...EMPTY })} className="btn btn-primary text-sm">+ New Course</button>}
      />

      <TableShell headers={["Title", "Category", "Mode", "Price", "Status", "Public", ""]}>
        {(courses || []).map((c) => (
          <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{c.title}</td>
            <td className="px-4 py-3">{c.category}</td>
            <td className="px-4 py-3 text-xs">{c.modes.join(", ")}</td>
            <td className="px-4 py-3">{c.price === 0 ? "Free" : formatINR(c.price)}</td>
            <td className="px-4 py-3"><span className={`pill ${c.status === "published" ? "pill-green" : c.status === "draft" ? "pill-amber" : "pill-gray"}`}>{c.status}</span></td>
            <td className="px-4 py-3"><a href={`/courses/${c.slug}`} target="_blank" rel="noopener noreferrer" className="text-primary text-xs">View ↗</a></td>
            <td className="px-4 py-3">
              <div className="flex gap-2">
                <button onClick={() => setEditing(c)} className="text-primary text-xs">Edit</button>
                <button onClick={() => remove(c.id)} className="text-danger text-xs">Delete</button>
              </div>
            </td>
          </tr>
        ))}
      </TableShell>

      {editing && <CourseForm course={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function CourseForm({ course, onClose, onSave }: { course: Partial<Course>; onClose: () => void; onSave: (c: Partial<Course>) => void }) {
  const [c, setC] = useState<Partial<Course>>(course);
  const set = (k: keyof Course, v: unknown) => setC((p) => ({ ...p, [k]: v }));

  function toggleMode(m: LearningMode) {
    const cur = c.modes || [];
    set("modes", cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]);
  }

  return (
    <Modal open onClose={onClose} title={c.id ? "Edit Course" : "New Course"} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div>
          <label className="label">Title</label>
          <input className="input" value={c.title || ""} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Category</label>
            <select className="input" value={c.category} onChange={(e) => set("category", e.target.value as CourseCategory)}>
              {COURSE_CATEGORIES.map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={c.status} onChange={(e) => set("status", e.target.value)}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input" rows={2} value={c.description || ""} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div>
          <label className="label">Modes</label>
          <div className="flex flex-wrap gap-2">
            {LEARNING_MODES.map((m) => (
              <button key={m} type="button" onClick={() => toggleMode(m as LearningMode)} className={`chip ${(c.modes || []).includes(m as LearningMode) ? "chip-active" : ""}`}>{m}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Price (₹)</label><input type="number" className="input" value={c.price ?? 0} onChange={(e) => set("price", Number(e.target.value))} /></div>
          <div><label className="label">Original price (₹)</label><input type="number" className="input" value={c.original_price ?? ""} onChange={(e) => set("original_price", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><label className="label">EMI / month (₹)</label><input type="number" className="input" value={c.emi_amount ?? ""} onChange={(e) => set("emi_amount", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><label className="label">EMI months</label><input type="number" className="input" value={c.emi_months ?? ""} onChange={(e) => set("emi_months", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><label className="label">Language</label><input className="input" value={c.language || ""} onChange={(e) => set("language", e.target.value)} /></div>
          <div><label className="label">Target years</label><input className="input" value={c.target_years || ""} onChange={(e) => set("target_years", e.target.value)} /></div>
          <div><label className="label">Duration</label><input className="input" value={c.duration || ""} onChange={(e) => set("duration", e.target.value)} /></div>
          <div><label className="label">Faculty</label><input className="input" value={c.faculty || ""} onChange={(e) => set("faculty", e.target.value)} /></div>
        </div>
        <div><label className="label">Included (comma separated)</label><input className="input" value={(c.included || []).join(", ")} onChange={(e) => set("included", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Brochure link</label><input className="input" value={c.brochure_link || ""} onChange={(e) => set("brochure_link", e.target.value)} /></div>
          <div><label className="label">Razorpay link</label><input className="input" value={c.razorpay_link || ""} onChange={(e) => set("razorpay_link", e.target.value)} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.featured} onChange={(e) => set("featured", e.target.checked)} /> Featured on homepage</label>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="btn btn-secondary flex-1">Cancel</button>
          <button onClick={() => onSave(c)} className="btn btn-primary flex-1">Save Course</button>
        </div>
      </div>
    </Modal>
  );
}
