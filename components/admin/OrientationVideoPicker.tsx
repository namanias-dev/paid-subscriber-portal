"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { CONTENT_META } from "@/lib/contentMeta";
import AppIcon from "@/components/ui/AppIcon";
import type { AssignedOrientationVideo, ContentItem, OrientationRole, OrientationTargetType } from "@/lib/types";

/**
 * Reusable picker for orientation / starter videos on a course/webinar's
 * "After Registration" section. It links to videos that already live in the
 * Content library (content_items) — one upload, assignable to many courses and
 * webinars — and persists each change immediately via /api/admin/orientation.
 */

/** A library item is "video-like" if it can actually be played as a video. */
function isVideoItem(c: ContentItem): boolean {
  if (c.type === "recording" || c.type === "live_link") return true;
  if (c.source_type === "hosted") return true;
  return !!(c.youtube_link || c.drive_link);
}

export default function OrientationVideoPicker({
  targetType,
  targetId,
}: {
  targetType: OrientationTargetType;
  targetId: string;
}) {
  const { toast } = useToast();
  const [assigned, setAssigned] = useState<AssignedOrientationVideo[]>([]);
  const [library, setLibrary] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  async function loadAssigned() {
    const res = await fetch(`/api/admin/orientation?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`);
    const data = await res.json().catch(() => ({}));
    if (data?.ok) setAssigned(data.videos || []);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [aRes, cRes] = await Promise.all([
        fetch(`/api/admin/orientation?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/admin/content`).then((r) => r.json()).catch(() => ({})),
      ]);
      if (!alive) return;
      if (aRes?.ok) setAssigned(aRes.videos || []);
      const items: ContentItem[] = Array.isArray(cRes?.content) ? cRes.content : Array.isArray(cRes) ? cRes : [];
      setLibrary(items.filter(isVideoItem));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [targetType, targetId]);

  const assignedIds = useMemo(() => new Set(assigned.map((a) => a.content.id)), [assigned]);

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return library
      .filter((c) => !assignedIds.has(c.id))
      .filter((c) => !needle || c.title.toLowerCase().includes(needle) || (c.subject || "").toLowerCase().includes(needle))
      .slice(0, 50);
  }, [library, assignedIds, search]);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    const res = await fetch("/api/admin/orientation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!data?.ok) {
      toast(data?.error || "Action failed", "error");
      return false;
    }
    return true;
  }

  async function add(contentId: string) {
    if (await post({ action: "assign", contentId, targetType, targetId, role: "orientation" })) {
      await loadAssigned();
      toast("Video linked", "success");
    }
  }

  async function remove(contentId: string) {
    if (await post({ action: "unassign", contentId, targetType, targetId })) {
      await loadAssigned();
      toast("Removed from this " + targetType, "success");
    }
  }

  async function setRole(contentId: string, role: OrientationRole) {
    setAssigned((prev) => prev.map((a) => (a.content.id === contentId ? { ...a, role } : a)));
    await post({ action: "assign", contentId, targetType, targetId, role });
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...assigned];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setAssigned(next);
    await post({ action: "reorder", targetType, targetId, orderedContentIds: next.map((a) => a.content.id) });
  }

  if (loading) return <p className="text-sm text-muted">Loading library videos…</p>;

  return (
    <div className="space-y-3">
      {/* Assigned list */}
      {assigned.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface2/40 px-3 py-4 text-sm text-muted">
          No library videos linked yet. Pick from the Content library below — the video is shared, not re-uploaded.
        </p>
      ) : (
        <div className="space-y-2">
          {assigned.map((a, i) => (
            <div key={a.assignment_id} className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2.5">
              <div className="flex flex-col">
                <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} className="text-xs text-muted disabled:opacity-30" aria-label="Move up">▲</button>
                <button type="button" disabled={busy || i === assigned.length - 1} onClick={() => move(i, 1)} className="text-xs text-muted disabled:opacity-30" aria-label="Move down">▼</button>
              </div>
              <AppIcon name={CONTENT_META[a.content.type]?.icon || "recording"} size={18} className="shrink-0 text-[var(--ca-navy-600)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.content.title}</p>
                <p className="truncate text-xs text-muted">
                  {a.content.source_type === "hosted" ? "Hosted recording" : a.content.youtube_link ? "YouTube" : a.content.drive_link ? "Drive" : "Link"}
                  {a.content.is_published ? "" : " · Draft (hidden from students)"}
                </p>
              </div>
              <select
                className="input h-9 w-32 text-xs"
                value={a.role}
                disabled={busy}
                onChange={(e) => setRole(a.content.id, e.target.value as OrientationRole)}
              >
                <option value="orientation">Orientation</option>
                <option value="starter">Starter</option>
              </select>
              <button type="button" disabled={busy} onClick={() => remove(a.content.id)} className="text-xs text-danger">Remove</button>
            </div>
          ))}
        </div>
      )}

      {/* Library picker */}
      {!showPicker ? (
        <button type="button" onClick={() => setShowPicker(true)} className="btn btn-secondary text-sm">+ Add from Content library</button>
      ) : (
        <div className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center gap-2">
            <input className="input text-sm" placeholder="Search library videos by title / subject…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            <button type="button" onClick={() => { setShowPicker(false); setSearch(""); }} className="text-xs text-muted">Close</button>
          </div>
          <div className="max-h-60 space-y-1 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="px-1 py-3 text-xs text-muted">No matching library videos. Upload one in the Content tab — it&apos;ll appear here.</p>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  onClick={() => add(c.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface2"
                >
                  <AppIcon name={CONTENT_META[c.type]?.icon || "recording"} size={16} className="shrink-0 text-[var(--ca-navy-600)]" />
                  <span className="flex-1 truncate">{c.title}</span>
                  {c.subject && <span className="pill pill-gray text-[10px]">{c.subject}</span>}
                  {!c.is_published && <span className="pill pill-amber text-[10px]">Draft</span>}
                  <span className="text-xs text-primary">Link →</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
      <p className="text-xs text-muted">
        These videos are shared from the Content library. Removing one here only unlinks it from this {targetType} — it stays in the library and in any other course/webinar.
      </p>
    </div>
  );
}
