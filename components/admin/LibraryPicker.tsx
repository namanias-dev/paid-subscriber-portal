"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { formatBytes } from "@/lib/dates";
import type { LibraryDoc } from "@/lib/types";

/**
 * Browse + select documents from the central Brochure / Resources Library.
 * Stores references (ids) only — never re-uploads. New uploads are added to the
 * shared library so they can be reused elsewhere.
 */
export default function LibraryPicker({
  value,
  onChange,
  hint,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  hint?: string;
}) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<LibraryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [uploading, setUploading] = useState(false);
  const selected = value || [];

  function load() {
    setLoading(true);
    fetch("/api/admin/library")
      .then((r) => r.json())
      .then((d) => setDocs(d.docs || []))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return docs;
    return docs.filter((d) => d.title.toLowerCase().includes(term) || (d.category || "").toLowerCase().includes(term));
  }, [docs, q]);

  const selectedDocs = selected.map((id) => docs.find((d) => d.id === id)).filter((d): d is LibraryDoc => !!d);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "library");
      const up = await (await fetch("/api/admin/upload", { method: "POST", body: fd })).json();
      if (!up.ok || !up.url) throw new Error(up.error || "Upload failed");
      const created = await (await fetch("/api/admin/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: file.name.replace(/\.pdf$/i, ""), file_url: up.url, file_size: file.size }),
      })).json();
      if (!created.ok || !created.doc) throw new Error(created.error || "Save failed");
      setDocs((cur) => [created.doc, ...cur]);
      onChange([...selected, created.doc.id]);
      toast("Uploaded & added to library", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-3">
      {hint && <p className="text-xs text-ink2">{hint}</p>}

      {selectedDocs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedDocs.map((d) => (
            <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full bg-surface2 px-3 py-1 text-xs">
              📄 {d.title}
              <button type="button" onClick={() => toggle(d.id)} className="text-danger" aria-label={`Remove ${d.title}`}>✕</button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input className="input flex-1 text-sm" placeholder="Search library…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="btn btn-secondary cursor-pointer text-sm">
          {uploading ? "Uploading…" : "+ Upload new"}
          <input type="file" accept="application/pdf" className="hidden" onChange={onUpload} />
        </label>
      </div>

      <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
        {loading ? (
          <p className="p-4 text-sm text-ink2">Loading library…</p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-ink2">No documents found. Upload one above to add it to the shared library.</p>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((d) => {
              const on = selected.includes(d.id);
              return (
                <li key={d.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-surface2">
                    <input type="checkbox" checked={on} onChange={() => toggle(d.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{d.title}</span>
                      <span className="block text-xs text-ink2">{d.category ? `${d.category} · ` : ""}{formatBytes(d.file_size)}</span>
                    </span>
                    <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-primary" onClick={(e) => e.stopPropagation()}>View ↗</a>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
