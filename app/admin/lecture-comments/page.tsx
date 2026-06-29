"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, useAdminData, LoadingBlock } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import type { Course, LectureComment } from "@/lib/types";

type QueueItem = { comment: LectureComment; lectureTitle: string; courseTitle: string | null };

function rel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function LectureCommentsAdmin() {
  const { data: courses } = useAdminData<Course[]>("/api/admin/courses", "courses");
  const { toast } = useToast();

  const [items, setItems] = useState<QueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [byCourse, setByCourse] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [courseId, setCourseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const courseTitle = useCallback((id: string) => (courses || []).find((c) => c.id === id)?.title || "Unknown course", [courses]);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = courseId ? `?courseId=${encodeURIComponent(courseId)}` : "";
    const res = await fetch(`/api/admin/lecture-comments${qs}`);
    const data = await res.json().catch(() => ({}));
    if (data?.ok) { setItems(data.items || []); setTotal(data.total || 0); setByCourse(data.byCourse || {}); }
    setLoading(false);
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  async function act(action: string, commentId: string, body?: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/lecture-comments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, commentId, body }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!data?.ok) { toast(data?.error || "Action failed", "error"); return; }
    toast(action === "reply" ? "Reply sent" : "Updated", "success");
    if (action === "reply") { setReplyFor(null); setReplyText(""); }
    await load();
  }

  const courseChips = useMemo(() => {
    return Object.entries(byCourse)
      .filter(([k]) => k !== "_")
      .map(([id, n]) => ({ id, n, title: courseTitle(id) }))
      .sort((a, b) => b.n - a.n);
  }, [byCourse, courseTitle]);

  if (loading && items.length === 0) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Lecture Q&A — Unanswered"
        subtitle="Student questions across all lectures, oldest first, so nothing gets buried. Replying marks the thread answered."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-danger/10 px-3 py-1 text-sm font-bold text-danger">{total} unanswered</span>
        <button onClick={() => setCourseId("")} className={`pill ${courseId === "" ? "pill-blue" : "pill-gray"}`}>All courses</button>
        {courseChips.map((c) => (
          <button key={c.id} onClick={() => setCourseId(c.id)} className={`pill ${courseId === c.id ? "pill-blue" : "pill-gray"}`}>
            {c.title} ({c.n})
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface2/40 px-4 py-10 text-center text-sm text-muted">
          🎉 No unanswered questions{courseId ? " for this course" : ""}. All caught up!
        </p>
      ) : (
        <div className="space-y-3">
          {items.map(({ comment: c, lectureTitle, courseTitle: ct }) => (
            <div key={c.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>
                  <span className="font-semibold text-ink">{lectureTitle}</span>
                  {ct && <span> · {ct}</span>}
                </span>
                <span>{rel(c.created_at)}</span>
              </div>
              <p className="mt-1 text-sm"><span className="font-semibold">{c.author_name}</span> <span className="text-muted">asked:</span></p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink2">{c.body}</p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => { setReplyFor(replyFor === c.id ? null : c.id); setReplyText(""); }} className="btn btn-primary text-xs">Reply</button>
                <button disabled={busy} onClick={() => act("answer", c.id)} className="btn btn-secondary text-xs">Mark answered</button>
                <button disabled={busy} onClick={() => act("pin", c.id)} className="btn btn-ghost text-xs">Pin</button>
                <button disabled={busy} onClick={() => act("hide", c.id)} className="btn btn-ghost text-xs text-danger">Hide</button>
                <a href={`/lecture/${c.recording_id}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost text-xs">Open lecture ↗</a>
              </div>

              {replyFor === c.id && (
                <div className="mt-3">
                  <textarea className="input text-sm" rows={3} maxLength={2000} placeholder="Reply as faculty — this resolves the question and notifies the student." value={replyText} onChange={(e) => setReplyText(e.target.value)} />
                  <div className="mt-1.5 flex gap-2">
                    <button disabled={busy || !replyText.trim()} onClick={() => act("reply", c.id, replyText)} className="btn btn-primary text-xs">Send reply</button>
                    <button onClick={() => { setReplyFor(null); setReplyText(""); }} className="btn btn-ghost text-xs">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
