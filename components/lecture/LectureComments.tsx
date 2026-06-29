"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, Pin, EyeOff, Eye, CheckCircle2, Shield, GraduationCap, CornerDownRight } from "lucide-react";
import type { LectureComment } from "@/lib/types";

/**
 * Per-lecture comments / Q&A. Enrolled-cohort visible (the API enforces access);
 * one level of replies; staff replies carry a Faculty/Admin badge and resolve the
 * thread. User text is rendered as PLAIN TEXT (React escapes it) so no injected
 * HTML/script can execute. Mobile-first.
 */

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX = 2000;

type Viewer = { authorId: string; kind: "student" | "staff"; canModerate: boolean };

function rel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function StaffBadge({ role }: { role: string | null }) {
  const isAdmin = (role || "").toLowerCase().includes("admin");
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${isAdmin ? "bg-[var(--ca-gold)] text-[#1a1304]" : "bg-primary/15 text-primary"}`}>
      {isAdmin ? <Shield size={11} /> : <GraduationCap size={11} />}
      {isAdmin ? "Admin" : "Faculty"}
    </span>
  );
}

export default function LectureComments({ recordingId }: { recordingId: string }) {
  const [comments, setComments] = useState<LectureComment[]>([]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/lectures/${recordingId}/comments`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setError("Comments aren't available for this lecture."); return; }
      setComments(data.comments || []);
      setViewer(data.viewer || null);
      setError(null);
    } catch {
      setError("Network error — please retry.");
    } finally {
      setLoading(false);
    }
  }, [recordingId]);

  useEffect(() => { load(); }, [load]);

  async function post(body: string, parentCommentId?: string) {
    const clean = body.trim();
    if (!clean) return;
    setBusy(true);
    const res = await fetch(`/api/lectures/${recordingId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: clean, parentCommentId }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) { setError(data.error || "Could not post."); return; }
    setError(null);
    setText(""); setReplyText(""); setReplyTo(null);
    await load();
  }

  async function saveEdit(commentId: string) {
    const clean = editText.trim();
    if (!clean) return;
    setBusy(true);
    const res = await fetch(`/api/lectures/${recordingId}/comments/${commentId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: clean }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) { setError(data.error || "Could not save."); return; }
    setEditId(null); setEditText(""); await load();
  }

  async function removeOwn(commentId: string) {
    if (!confirm("Delete your comment?")) return;
    setBusy(true);
    await fetch(`/api/lectures/${recordingId}/comments/${commentId}`, { method: "DELETE" });
    setBusy(false);
    await load();
  }

  async function moderate(action: string, commentId: string, replyBody?: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/lecture-comments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, commentId, body: replyBody }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) { setError(data.error || "Action failed."); return; }
    if (action === "reply") { setReplyText(""); setReplyTo(null); }
    await load();
  }

  const canEdit = (c: LectureComment) =>
    viewer && c.author_id === viewer.authorId && Date.now() - new Date(c.created_at).getTime() < EDIT_WINDOW_MS;

  // Build thread structure: pinned-first then newest-first top-level; replies oldest-first.
  const top = comments
    .filter((c) => !c.parent_comment_id)
    .sort((a, b) => (Number(b.is_pinned) - Number(a.is_pinned)) || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  const repliesByParent = comments.reduce<Record<string, LectureComment[]>>((acc, c) => {
    if (c.parent_comment_id) (acc[c.parent_comment_id] ||= []).push(c);
    return acc;
  }, {});

  function Comment({ c, isReply }: { c: LectureComment; isReply?: boolean }) {
    const staff = c.author_kind === "staff";
    return (
      <div className={`${isReply ? "ml-7 mt-3" : ""} ${staff ? "rounded-xl border-l-2 border-[var(--ca-gold)] bg-[rgba(212,175,55,0.06)] p-3" : "p-1"}`}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{c.author_name}</span>
          {staff && <StaffBadge role={c.author_role} />}
          {c.is_pinned && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-primary"><Pin size={11} /> Pinned</span>}
          {c.is_answered && !isReply && <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success"><CheckCircle2 size={11} /> Answered</span>}
          {c.is_hidden && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger">Hidden</span>}
          <span className="text-xs text-muted">· {rel(c.created_at)}{c.edited_at ? " · edited" : ""}</span>
        </div>

        {editId === c.id ? (
          <div className="mt-2">
            <textarea className="input text-sm" rows={2} maxLength={MAX} value={editText} onChange={(e) => setEditText(e.target.value)} />
            <div className="mt-1 flex gap-2">
              <button disabled={busy} onClick={() => saveEdit(c.id)} className="btn btn-primary text-xs">Save</button>
              <button onClick={() => { setEditId(null); setEditText(""); }} className="btn btn-ghost text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink2">{c.body}</p>
        )}

        {/* Action row */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {!isReply && <button onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(""); }} className="font-medium text-primary">Reply</button>}
          {canEdit(c) && editId !== c.id && (
            <>
              <button onClick={() => { setEditId(c.id); setEditText(c.body); }} className="text-ink2 hover:text-ink">Edit</button>
              <button onClick={() => removeOwn(c.id)} className="text-danger">Delete</button>
            </>
          )}
          {viewer?.canModerate && (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
              <button onClick={() => moderate(c.is_pinned ? "unpin" : "pin", c.id)} className="inline-flex items-center gap-1 hover:text-ink"><Pin size={12} /> {c.is_pinned ? "Unpin" : "Pin"}</button>
              <button onClick={() => moderate(c.is_hidden ? "unhide" : "hide", c.id)} className="inline-flex items-center gap-1 hover:text-ink">{c.is_hidden ? <Eye size={12} /> : <EyeOff size={12} />} {c.is_hidden ? "Unhide" : "Hide"}</button>
              {!isReply && <button onClick={() => moderate(c.is_answered ? "unanswer" : "answer", c.id)} className="inline-flex items-center gap-1 hover:text-ink"><CheckCircle2 size={12} /> {c.is_answered ? "Unmark" : "Answered"}</button>}
            </span>
          )}
        </div>

        {/* Reply composer */}
        {replyTo === c.id && (
          <div className="ml-7 mt-2">
            <textarea className="input text-sm" rows={2} maxLength={MAX} placeholder={viewer?.canModerate ? "Reply as faculty…" : "Write a reply…"} value={replyText} onChange={(e) => setReplyText(e.target.value)} />
            <div className="mt-1 flex gap-2">
              <button disabled={busy || !replyText.trim()} onClick={() => post(replyText, c.id)} className="btn btn-primary text-xs">
                {busy ? <Loader2 size={13} className="animate-spin" /> : "Reply"}
              </button>
              <button onClick={() => { setReplyTo(null); setReplyText(""); }} className="btn btn-ghost text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* Replies */}
        {!isReply && (repliesByParent[c.id] || [])
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          .map((r) => (
            <div key={r.id} className="relative">
              <CornerDownRight size={13} className="absolute left-1 top-4 text-line" />
              <Comment c={r} isReply />
            </div>
          ))}
      </div>
    );
  }

  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
        <MessageCircle size={18} className="text-[var(--ca-gold)]" /> Questions &amp; discussion
      </h2>
      <p className="mt-1 text-sm text-muted">Ask about this lecture — your faculty and classmates can help. Be respectful.</p>

      {/* New comment */}
      <div className="mt-4">
        <textarea
          className="input text-sm"
          rows={3}
          maxLength={MAX}
          placeholder="Ask a question or share a note about this lecture…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[11px] text-muted">{text.length}/{MAX}</span>
          <button disabled={busy || !text.trim()} onClick={() => post(text)} className="btn btn-primary text-sm">
            {busy ? <Loader2 size={14} className="animate-spin" /> : "Post"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {/* List */}
      <div className="mt-5 space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Loading comments…</div>
        ) : top.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-surface2/40 px-4 py-6 text-center text-sm text-muted">No questions yet — be the first to ask.</p>
        ) : (
          top.map((c) => (
            <div key={c.id} className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
              <Comment c={c} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
