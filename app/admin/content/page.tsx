"use client";

import { useMemo, useRef, useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useUploadManager } from "@/components/admin/upload/uploadManager";
import { CONTENT_META } from "@/lib/contentMeta";
import { SUBJECTS } from "@/lib/config";
import { formatDate } from "@/lib/dates";
import type { ContentItem, ContentType, Course, Webinar, OrientationRole } from "@/lib/types";

/** Read duration + resolution from a video file (client-side; no processing). */
function readVideoMeta(file: File): Promise<{ duration: number | null; resolution: string | null }> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        const out = {
          duration: Number.isFinite(v.duration) ? Math.round(v.duration) : null,
          resolution: v.videoWidth && v.videoHeight ? `${v.videoWidth}x${v.videoHeight}` : null,
        };
        URL.revokeObjectURL(url);
        resolve(out);
      };
      v.onerror = () => { URL.revokeObjectURL(url); resolve({ duration: null, resolution: null }); };
      v.src = url;
    } catch {
      resolve({ duration: null, resolution: null });
    }
  });
}

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
  faculty: "",
  date: "",
  class_no: "",
  course_ids: [] as string[],
  is_published: true,
  drip_date: "",
  source_type: "link" as "link" | "hosted",
  visibility: "enrolled" as "enrolled" | "public",
};
type FormState = typeof EMPTY_FORM;

function itemCourseIds(c: ContentItem): string[] {
  return c.course_ids && c.course_ids.length ? c.course_ids : c.course_id ? [c.course_id] : [];
}

export default function ContentAdmin() {
  const { data: content, loading, reload } = useAdminData<ContentItem[]>("/api/admin/content", "content");
  const { data: courses } = useAdminData<Course[]>("/api/admin/courses", "courses");
  const { data: webinars } = useAdminData<Webinar[]>("/api/admin/webinars", "webinars");
  const { toast } = useToast();
  const { startUpload } = useUploadManager();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const thumbInput = useRef<HTMLInputElement>(null);
  const editing = !!form.id;

  // Orientation / starter assignment (reuse this video in After-Registration of
  // many courses/webinars). Keys are "course:<id>" / "webinar:<id>".
  const [orientRole, setOrientRole] = useState<OrientationRole>("orientation");
  const [orientTargets, setOrientTargets] = useState<Set<string>>(new Set());
  const webinarList = useMemo(() => webinars || [], [webinars]);

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
    setVideoFile(null);
    setThumbFile(null);
    setOrientRole("orientation");
    setOrientTargets(new Set());
    setOpen(true);
  }

  async function openEdit(c: ContentItem) {
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
      faculty: c.faculty || "",
      date: c.date ? c.date.slice(0, 10) : "",
      class_no: c.class_no != null ? String(c.class_no) : "",
      course_ids: itemCourseIds(c),
      is_published: c.is_published,
      drip_date: c.drip_date ? c.drip_date.slice(0, 10) : "",
      source_type: c.source_type === "hosted" ? "hosted" : "link",
      visibility: c.visibility === "public" ? "public" : "enrolled",
    });
    setVideoFile(null);
    setThumbFile(null);
    setOrientRole("orientation");
    setOrientTargets(new Set());
    setOpen(true);
    // Load existing orientation/starter assignments for this video.
    try {
      const res = await fetch(`/api/admin/orientation?contentId=${c.id}`);
      const data = await res.json().catch(() => ({}));
      if (data?.ok && Array.isArray(data.assignments)) {
        setOrientTargets(new Set(data.assignments.map((a: { target_type: string; target_id: string }) => `${a.target_type}:${a.target_id}`)));
        if (data.assignments[0]?.role) setOrientRole(data.assignments[0].role as OrientationRole);
      }
    } catch {
      /* non-fatal — the picker just starts empty */
    }
  }

  function toggleOrient(key: string) {
    setOrientTargets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
    const hosted = isRecording && form.source_type === "hosted";
    if (hosted && !editing && !videoFile) {
      toast("Select a video file to upload", "error");
      return;
    }
    const payload = {
      type: form.type,
      title: form.title.trim(),
      subject: form.subject || null,
      paper: form.paper || null,
      description: form.description || null,
      drive_link: hosted ? null : form.drive_link || null,
      youtube_link: hosted ? null : form.youtube_link || null,
      telegram_link: hosted ? null : form.telegram_link || null,
      duration: form.duration || null,
      faculty: form.faculty || null,
      date: form.date || null,
      class_no: form.class_no === "" ? null : Number(form.class_no),
      course_ids: form.course_ids,
      is_published: form.is_published,
      drip_date: form.drip_date || null,
      source_type: hosted ? "hosted" : "link",
      visibility: form.visibility,
    };
    const res = editing
      ? await fetch(`/api/admin/content/${form.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch("/api/admin/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      toast("Could not save", "error");
      return;
    }
    const data = await res.json().catch(() => ({}));
    const recordingId: string | undefined = data?.content?.id || form.id;

    // Sync orientation/starter assignments for video items (reconciles add/remove).
    const isVideoType = form.type === "recording" || form.type === "live_link";
    if (recordingId && isVideoType) {
      const targets = [...orientTargets].map((k) => {
        const idx = k.indexOf(":");
        return { type: k.slice(0, idx), id: k.slice(idx + 1) };
      });
      await fetch("/api/admin/orientation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setTargets", contentId: recordingId, role: orientRole, targets }),
      }).catch(() => null);
    }

    // Optional thumbnail → presigned PUT to R2 (persists thumbnail_key). Best-effort.
    if (thumbFile && recordingId) {
      try {
        const sign = await fetch("/api/admin/lectures/asset/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordingId, kind: "thumbnail", contentType: thumbFile.type || "image/jpeg" }),
        });
        const sd = await sign.json().catch(() => ({}));
        if (sd?.ok && sd.url) {
          await fetch(sd.url, { method: "PUT", headers: { "Content-Type": thumbFile.type || "image/jpeg" }, body: thumbFile });
        } else {
          toast("Thumbnail upload skipped (hosting not configured)", "error");
        }
      } catch {
        toast("Thumbnail upload failed — content was saved", "error");
      }
    }

    // Hosted + a file chosen → kick off the resilient background upload.
    if (hosted && videoFile && recordingId) {
      const meta = await readVideoMeta(videoFile);
      startUpload({
        recordingId,
        title: form.title.trim(),
        courseId: form.course_ids[0] || "_",
        file: videoFile,
        durationSeconds: meta.duration,
        resolution: meta.resolution,
        deletable: !editing,
      });
      toast("Upload started — it continues in the background.", "success");
    } else {
      toast(editing ? "Content updated" : "Content added", "success");
    }
    setOpen(false);
    setForm(EMPTY_FORM);
    setVideoFile(null);
    setThumbFile(null);
    reload();
  }

  async function togglePublish(item: ContentItem) {
    await fetch(`/api/admin/content/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_published: !item.is_published }) });
    reload();
  }

  async function remove(id: string) {
    let message = "Delete content?";
    try {
      const res = await fetch(`/api/admin/orientation?contentId=${id}`);
      const data = await res.json().catch(() => ({}));
      const n = data?.ok && Array.isArray(data.assignments) ? data.assignments.length : 0;
      if (n > 0) {
        message = `⚠️ This video is linked as an orientation/starter video in ${n} place${n === 1 ? "" : "s"} (course/webinar). Deleting it removes it from all of them. Continue?`;
      }
    } catch {
      /* fall back to the plain confirm */
    }
    if (!confirm(message)) return;
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
              <td className="px-4 py-3 text-xs">
                {CONTENT_META[c.type].label}
                {c.source_type === "hosted" && (
                  <span className={`pill ml-1 text-[10px] ${c.upload_status === "completed" ? "pill-green" : c.upload_status === "failed" ? "pill-red" : "pill-amber"}`}>
                    {c.upload_status === "completed" ? "Hosted" : c.upload_status === "uploading" ? "Uploading" : c.upload_status === "failed" ? "Upload failed" : "Hosted"}
                  </span>
                )}
                {c.visibility === "public" && <span className="pill pill-blue ml-1 text-[10px]">Public</span>}
              </td>
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

          {/* Reusable orientation / starter assignment (video items only) */}
          {isRecording && (
            <div className="rounded-xl border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.06)] p-3">
              <div className="flex items-center justify-between gap-2">
                <label className="label mb-0">Use as orientation / starter video</label>
                <select className="input h-9 w-36 text-xs" value={orientRole} onChange={(e) => setOrientRole(e.target.value as OrientationRole)}>
                  <option value="orientation">Orientation</option>
                  <option value="starter">Starter</option>
                </select>
              </div>
              <p className="mb-2 mt-1 text-xs text-muted">
                Shows in the &quot;After Registration&quot; section of the selected courses/webinars — same video, no re-upload.
              </p>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-line bg-surface p-2">
                {courseList.length === 0 && webinarList.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted">No courses or webinars found.</p>
                ) : (
                  <>
                    {courseList.map((c) => {
                      const key = `course:${c.id}`;
                      return (
                        <label key={key} className="flex min-h-[34px] cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface2">
                          <input type="checkbox" checked={orientTargets.has(key)} onChange={() => toggleOrient(key)} />
                          <span className="flex-1">{c.title}</span>
                          <span className="pill pill-blue text-[10px]">Course</span>
                        </label>
                      );
                    })}
                    {webinarList.map((w) => {
                      const key = `webinar:${w.id}`;
                      return (
                        <label key={key} className="flex min-h-[34px] cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface2">
                          <input type="checkbox" checked={orientTargets.has(key)} onChange={() => toggleOrient(key)} />
                          <span className="flex-1">{w.title}</span>
                          <span className="pill pill-gold text-[10px]">Webinar</span>
                        </label>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Class / Session #</label>
              <input className="input" type="number" min={0} placeholder="e.g. 1" value={form.class_no} onChange={(e) => setForm({ ...form, class_no: e.target.value })} />
            </div>
            <input className="input self-end" placeholder="Topic / Paper (e.g. GS2)" value={form.paper} onChange={(e) => setForm({ ...form, paper: e.target.value })} />
            <input className="input self-end" placeholder="Duration" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Lecture date</label>
              <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            {isRecording && (
              <div>
                <label className="label">Faculty (optional)</label>
                <input className="input" placeholder="e.g. Naman Sir" value={form.faculty} onChange={(e) => setForm({ ...form, faculty: e.target.value })} />
              </div>
            )}
          </div>

          {/* Optional custom thumbnail (recordings). YouTube auto-derives; else branded fallback. */}
          {isRecording && (
            <div>
              <label className="label">Thumbnail (optional)</label>
              <input ref={thumbInput} type="file" accept="image/*" className="hidden" onChange={(e) => setThumbFile(e.target.files?.[0] || null)} />
              <button type="button" onClick={() => thumbInput.current?.click()} className="btn btn-secondary w-full text-sm">
                {thumbFile ? `🖼️ ${thumbFile.name} (${(thumbFile.size / 1024).toFixed(0)} KB)` : "Upload custom thumbnail"}
              </button>
              <p className="mt-1 text-xs text-muted">Never required. YouTube videos auto-use their own thumbnail; anything without one gets a premium branded fallback.</p>
            </div>
          )}

          {/* Recording source toggle (only for recordings / live links) */}
          {isRecording && (
            <div>
              <label className="label">Recording source</label>
              <div className="grid grid-cols-2 gap-2">
                {(["link", "hosted"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm({ ...form, source_type: s })}
                    className={`min-h-[44px] rounded-xl border px-3 text-sm font-semibold transition ${form.source_type === s ? "border-[var(--ca-gold)] bg-[rgba(212,175,55,0.12)] text-ink" : "border-line bg-surface text-ink2 hover:border-[rgba(212,175,55,0.5)]"}`}
                  >
                    {s === "link" ? "🔗 External link" : "⬆️ Upload video (hosted)"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Hosted upload */}
          {isRecording && form.source_type === "hosted" ? (
            <div className="space-y-3 rounded-xl border border-line p-3">
              <div>
                <p className="mb-1 text-xs font-semibold text-ink2">Upload an already-compressed MP4 (≈300–500MB). It uploads in the background — you can keep working.</p>
                <input
                  ref={videoInput}
                  type="file"
                  accept="video/mp4,video/*"
                  className="hidden"
                  onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                />
                <button type="button" onClick={() => videoInput.current?.click()} className="btn btn-secondary w-full text-sm">
                  {videoFile ? `🎬 ${videoFile.name} (${(videoFile.size / 1024 ** 2).toFixed(0)} MB)` : editing ? "Replace video file (optional)" : "Choose video file"}
                </button>
              </div>
              <div>
                <label className="label">Visibility</label>
                <select className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as "enrolled" | "public" })}>
                  <option value="enrolled">Enrolled only (entitlement-gated)</option>
                  <option value="public">Public (free / marketing — no login)</option>
                </select>
              </div>
              <p className="text-xs text-muted">Full-payment access window (Lifetime / N months) is set per course under Courses → Access &amp; Entitlements. Per-student grant/extend/revoke lives in Access at Risk.</p>
            </div>
          ) : (
            /* External links only */
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
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Drip release date</label><input type="date" className="input" value={form.drip_date} onChange={(e) => setForm({ ...form, drip_date: e.target.value })} /></div>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} /> Publish now</label>
          </div>
          <button onClick={save} className="btn btn-primary w-full">
            {isRecording && form.source_type === "hosted" && videoFile ? "Save & start upload" : editing ? "Save changes" : "Add Content"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
