"use client";

import { useMemo, useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CONTENT_META } from "@/lib/contentMeta";
import { SUBJECTS } from "@/lib/config";
import { formatDate } from "@/lib/dates";
import type { ContentItem, ContentType, Course } from "@/lib/types";

const TYPES = Object.keys(CONTENT_META) as ContentType[];

const EMPTY_FORM = {
  id: "",
  type: "recording" as ContentType,
  title: "",
  subject: "",
  paper: "",
  description: "",
  drive_link: "",
  youtube_link: "",
  telegram_link: "",
  duration: "",
  class_no: "",
  course_ids: [] as string[],
  is_published: true,
  drip_date: "",
};
type FormState = typeof EMPTY_FORM;

function itemCourseIds(c: ContentItem): string[] {
  return c.course_ids && c.course_ids.length ? c.course_ids : c.course_id ? [c.course_id] : [];
}

export default function ContentAdmin() {
  const { data: content, loading, reload } = useAdminData<ContentItem[]>("/api/admin/content", "content");
  const { data: courses } = useAdminData<Course[]>("/api/admin/courses", "courses");
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const editing = !!form.id;

  // Filters
  const [q, setQ] = useState("");
  const [fCourse, setFCourse] = useState("");
  const [fType, setFType] = useState("");
  const [fSubject, setFSubject] = useState("");
  const [fStatus, setFStatus] = useState("");

  const courseList = courses || [];
  const courseTitle = (id: string) => courseList.find((c) => c.id === id)?.title || "Unknown batch";

  const rows = useMemo(() => {
    let list = [...(content || [])];
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((c) => c.title.toLowerCase().includes(needle) || (c.subject || "").toLowerCase().includes(needle));
    }
    if (fCourse) list = list.filter((c) => itemCourseIds(c).includes(fCourse));
    if (fType) list = list.filter((c) => c.type === fType);
    if (fSubject) list = list.filter((c) => c.subject === fSubject);
    if (fStatus) list = list.filter((c) => (fStatus === "published" ? c.is_published : !c.is_published));
    list.sort((a, b) => new Date(b.date || b.created_at).getTime() - new Date(a.date || a.created_at).getTime());
    return list;
  }, [content, q, fCourse, fType, fSubject, fStatus]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(c: ContentItem) {
    setForm({
      id: c.id,
      type: c.type,
      title: c.title,
      subject: c.subject || "",
      paper: c.paper || "",
      description: c.description || "",
      drive_link: c.drive_link || "",
      youtube_link: c.youtube_link || "",
      telegram_link: c.telegram_link || "",
      duration: c.duration || "",
      class_no: c.class_no != null ? String(c.class_no) : "",
      course_ids: itemCourseIds(c),
      is_published: c.is_published,
      drip_date: c.drip_date ? c.drip_date.slice(0, 10) : "",
    });
    setOpen(true);
  }

  function toggleCourse(id: string) {
    setForm((f) => ({
      ...f,
      course_ids: f.course_ids.includes(id) ? f.course_ids.filter((x) => x !== id) : [...f.course_ids, id],
    }));
  }

  async function save() {
    if (!form.title.trim()) {
      toast("Title required", "error");
      return;
    }
    const payload = {
      type: form.type,
      title: form.title.trim(),
      subject: form.subject || null,
      paper: form.paper || null,
      description: form.description || null,
      drive_link: form.drive_link || null,
      youtube_link: form.youtube_link || null,
      telegram_link: form.telegram_link || null,
      duration: form.duration || null,
      class_no: form.class_no === "" ? null : Number(form.class_no),
      course_ids: form.course_ids,
      is_published: form.is_published,
      drip_date: form.drip_date || null,
    };
    const res = editing
      ? await fetch(`/api/admin/content/${form.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch("/api/admin/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      toast("Could not save", "error");
      return;
    }
    toast(editing ? "Content updated" : "Content added", "success");
    setOpen(false);
    setForm(EMPTY_FORM);
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

  // Smart helper: which links to surface first by type (still allow all three).
  const isRecording = form.type === "recording" || form.type === "live_link";

  return (
    <div>
      <PageHeader title="Content / LMS Manager" subtitle="Assign recordings, notes, tests & CA to batches — they appear in students' Class Hub." action={<button onClick={openAdd} className="btn btn-primary text-sm">+ Add Content</button>} />

      {/* Filters */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input className="input" placeholder="Search title / subject…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={fCourse} onChange={(e) => setFCourse(e.target.value)}>
          <option value="">All batches</option>
          {courseList.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <select className="input" value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{CONTENT_META[t].label}</option>)}
        </select>
        <select className="input" value={fSubject} onChange={(e) => setFSubject(e.target.value)}>
          <option value="">All subjects</option>
          {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="input" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      <TableShell headers={["Title", "Type", "Subject", "Batches", "Date", "Published", ""]}>
        {rows.map((c) => {
          const cids = itemCourseIds(c);
          return (
            <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface2">
              <td className="px-4 py-3 font-medium">
                {CONTENT_META[c.type].icon} {c.class_no != null && <span className="text-primary">C{c.class_no} · </span>}{c.title}
              </td>
              <td className="px-4 py-3 text-xs">{CONTENT_META[c.type].label}</td>
              <td className="px-4 py-3">{c.subject || "—"}</td>
              <td className="px-4 py-3">
                {cids.length === 0 ? (
                  <span className="text-xs text-muted">Unassigned</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {cids.slice(0, 2).map((id) => <span key={id} className="pill pill-blue text-[10px]">{courseTitle(id)}</span>)}
                    {cids.length > 2 && <span className="pill pill-gray text-[10px]">+{cids.length - 2}</span>}
                  </div>
                )}
              </td>
              <td className="px-4 py-3">{formatDate(c.date)}</td>
              <td className="px-4 py-3">
                <button onClick={() => togglePublish(c)} className={`pill ${c.is_published ? "pill-green" : "pill-gray"}`}>{c.is_published ? "Live" : "Draft"}</button>
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-3">
                  <button onClick={() => openEdit(c)} className="text-primary text-xs">Edit</button>
                  <button onClick={() => remove(c.id)} className="text-danger text-xs">Delete</button>
                </div>
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">No content matches these filters.</td></tr>
        )}
      </TableShell>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Content" : "Add Content"} maxWidth="max-w-lg">
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

          {/* Assign to course(s)/batch(es) */}
          <div>
            <label className="label">Assign to course(s) / batch(es)</label>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
              {courseList.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted">No courses found.</p>
              ) : (
                courseList.map((c) => (
                  <label key={c.id} className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface2">
                    <input type="checkbox" checked={form.course_ids.includes(c.id)} onChange={() => toggleCourse(c.id)} />
                    <span className="flex-1">{c.title}</span>
                    {c.category && <span className="pill pill-gray text-[10px]">{c.category}</span>}
                  </label>
                ))
              )}
            </div>
            <p className="mt-1 text-xs text-muted">One item can belong to multiple batches — it appears in each batch&apos;s Class Hub. Leave empty for a global library item.</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Class / Session #</label>
              <input className="input" type="number" min={0} placeholder="e.g. 1" value={form.class_no} onChange={(e) => setForm({ ...form, class_no: e.target.value })} />
            </div>
            <input className="input self-end" placeholder="Paper (e.g. GS2)" value={form.paper} onChange={(e) => setForm({ ...form, paper: e.target.value })} />
            <input className="input self-end" placeholder="Duration" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
          </div>

          {/* External links only */}
          <div className="rounded-xl border border-line p-3">
            <p className="mb-2 text-xs font-semibold text-ink2">External links only — YouTube / Drive / Telegram (any one or a combination)</p>
            {isRecording ? (
              <>
                <input className="input mb-2" placeholder="YouTube link" value={form.youtube_link} onChange={(e) => setForm({ ...form, youtube_link: e.target.value })} />
                <input className="input mb-2" placeholder="Google Drive link" value={form.drive_link} onChange={(e) => setForm({ ...form, drive_link: e.target.value })} />
                <input className="input" placeholder="Telegram link" value={form.telegram_link} onChange={(e) => setForm({ ...form, telegram_link: e.target.value })} />
              </>
            ) : (
              <>
                <input className="input mb-2" placeholder="Google Drive / PDF link" value={form.drive_link} onChange={(e) => setForm({ ...form, drive_link: e.target.value })} />
                <input className="input mb-2" placeholder="Telegram link" value={form.telegram_link} onChange={(e) => setForm({ ...form, telegram_link: e.target.value })} />
                <input className="input" placeholder="YouTube link (optional)" value={form.youtube_link} onChange={(e) => setForm({ ...form, youtube_link: e.target.value })} />
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Drip release date</label><input type="date" className="input" value={form.drip_date} onChange={(e) => setForm({ ...form, drip_date: e.target.value })} /></div>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} /> Publish now</label>
          </div>
          <button onClick={save} className="btn btn-primary w-full">{editing ? "Save changes" : "Add Content"}</button>
        </div>
      </Modal>
    </div>
  );
}
