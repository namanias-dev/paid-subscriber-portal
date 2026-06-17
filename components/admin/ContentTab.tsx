"use client";

import { useEffect, useMemo, useState } from "react";
import FilterTabs from "@/components/ui/FilterTabs";
import Modal from "@/components/ui/Modal";
import EmptyState from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { CONTENT_META } from "@/lib/contentMeta";
import { SUBJECTS } from "@/lib/config";
import { formatDate, todayISODate } from "@/lib/dates";
import type { ContentItem, ContentType } from "@/lib/types";

const TYPE_TABS = [
  { id: "all", label: "All" },
  { id: "current_affairs", label: "CA" },
  { id: "mcq", label: "MCQs" },
  { id: "booklet", label: "Booklets" },
  { id: "pyq", label: "PYQs" },
  { id: "recording", label: "Recordings" },
  { id: "live_link", label: "Live" },
  { id: "answer_writing", label: "Answer Writing" },
  { id: "test_series", label: "Test Series" },
];

const PAPERS = ["GS1", "GS2", "GS3", "GS4", "CSAT", "Optional", "Essay"];

export default function ContentTab() {
  const { toast } = useToast();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/content", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) setItems(data.content);
    } catch {
      toast("Failed to load content", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => (tab === "all" ? items : items.filter((i) => i.type === tab)),
    [items, tab]
  );

  async function togglePublish(item: ContentItem) {
    try {
      const res = await fetch(`/api/admin/content/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_published: !item.is_published }),
      });
      const data = await res.json();
      if (data.ok) {
        toast(item.is_published ? "Unpublished" : "Published ✅", "success");
        load();
      }
    } catch {
      toast("Action failed", "error");
    }
  }

  async function remove(item: ContentItem) {
    if (!confirm(`Delete "${item.title}"?`)) return;
    try {
      const res = await fetch(`/api/admin/content/${item.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        toast("Deleted", "success");
        load();
      }
    } catch {
      toast("Delete failed", "error");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading text-lg text-text">Content Manager</h3>
        <button onClick={() => setAdding(true)} className="btn-gold text-sm">
          + Add Content
        </button>
      </div>

      <FilterTabs options={TYPE_TABS} active={tab} onChange={setTab} />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="🗂️" title="No content yet" subtitle="Add booklets, MCQs, recordings and more." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((item) => (
            <div key={item.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <span className="text-xl">{CONTENT_META[item.type].icon}</span>
                  <div>
                    <p className="font-medium text-text">{item.title}</p>
                    <p className="text-xs text-muted">
                      {[item.subject, item.paper, formatDate(item.date)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
                <span
                  className={`pill ${item.is_published ? "pill-active" : "pill-expired"}`}
                >
                  {item.is_published ? "Published" : "Draft"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                <button onClick={() => togglePublish(item)} className="rounded-md border px-2 py-1 text-xs text-gold-light" style={{ borderColor: "var(--border)" }}>
                  {item.is_published ? "Unpublish" : "Publish"}
                </button>
                <button onClick={() => setEditing(item)} className="rounded-md border px-2 py-1 text-xs text-gold-light" style={{ borderColor: "var(--border)" }}>
                  Edit
                </button>
                <button onClick={() => remove(item)} className="rounded-md border px-2 py-1 text-xs" style={{ borderColor: "rgba(231,76,60,0.5)", color: "#ff9a8f" }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <ContentFormModal
          item={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ContentFormModal({
  item,
  onClose,
  onSaved,
}: {
  item: ContentItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState<ContentType>(item?.type || "current_affairs");
  const [subject, setSubject] = useState(item?.subject || "");
  const [paper, setPaper] = useState(item?.paper || "");
  const [title, setTitle] = useState(item?.title || "");
  const [description, setDescription] = useState(item?.description || "");
  const [driveLink, setDriveLink] = useState(item?.drive_link || "");
  const [youtubeLink, setYoutubeLink] = useState(item?.youtube_link || "");
  const [date, setDate] = useState(item?.date || todayISODate());
  const [duration, setDuration] = useState(item?.duration || "");
  const [published, setPublished] = useState(item?.is_published ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!title.trim()) return setError("Title is required.");
    setSaving(true);
    const body = {
      type,
      subject: subject || null,
      paper: paper || null,
      title: title.trim(),
      description: description || null,
      drive_link: driveLink || null,
      youtube_link: youtubeLink || null,
      date,
      duration: duration || null,
      is_published: published,
    };
    try {
      const res = await fetch(
        item ? `/api/admin/content/${item.id}` : "/api/admin/content",
        {
          method: item ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();
      if (data.ok) {
        toast(item ? "Content updated" : "Content added ✅", "success");
        onSaved();
      } else {
        setError(data.error || "Save failed.");
      }
    } catch {
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const TYPES = Object.keys(CONTENT_META) as ContentType[];

  return (
    <Modal open onClose={onClose} title={item ? "Edit Content" : "Add Content"}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <select value={type} onChange={(e) => setType(e.target.value as ContentType)} className="input-field">
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {CONTENT_META[t].label}
              </option>
            ))}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-field" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <select value={subject} onChange={(e) => setSubject(e.target.value)} className="input-field">
            <option value="">Subject</option>
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={paper} onChange={(e) => setPaper(e.target.value)} className="input-field">
            <option value="">Paper</option>
            {PAPERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" placeholder="Title *" />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input-field"
          placeholder="Description"
          rows={2}
        />
        <input value={driveLink} onChange={(e) => setDriveLink(e.target.value)} className="input-field" placeholder="Google Drive link (PDF)" />
        <input value={youtubeLink} onChange={(e) => setYoutubeLink(e.target.value)} className="input-field" placeholder="YouTube link (video / live)" />
        <input value={duration} onChange={(e) => setDuration(e.target.value)} className="input-field" placeholder="Duration (e.g. 12 min read / 1h 20m)" />

        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="h-4 w-4 accent-[#c9a84c]"
          />
          Published (visible to students)
        </label>

        {error && (
          <p className="rounded-lg bg-[rgba(231,76,60,0.12)] px-3 py-2 text-sm text-[#ff9a8f]">
            {error}
          </p>
        )}

        <button onClick={save} disabled={saving} className="btn-gold w-full">
          {saving ? "Saving..." : item ? "Save changes" : "Add Content"}
        </button>
      </div>
    </Modal>
  );
}
