"use client";

import { useEffect, useRef, useState } from "react";
import { FormShell, Section, FormActions } from "./FormKit";
import { useToast } from "@/components/ui/Toast";
import { DEFAULT_SITE_SETTINGS } from "@/lib/homeDefaults";
import type { SiteSettings, Topper } from "@/lib/types";

const BACK = "/admin";
const ACCEPTED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024; // ~2MB

function newTopper(order: number): Topper {
  return { id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: "", rank: "", exam: "", image_url: null, order };
}

/** Per-topper image upload with type/size validation + preview. Reuses /api/admin/upload (Supabase media bucket). */
function TopperImage({ value, onChange }: { value: string | null | undefined; onChange: (url: string | null) => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (ref.current) ref.current.value = "";
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast("Use a JPG, PNG or WEBP image.", "error");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast("Image too large (max 2 MB).", "error");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "toppers");
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok && data.url) {
        onChange(data.url);
        toast("Photo uploaded", "success");
      } else {
        toast(data.error || "Upload failed", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-line bg-surface2">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="topper" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted">No photo</div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="btn btn-secondary text-xs">
          {busy ? "Uploading…" : value ? "Replace" : "Upload"}
        </button>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="btn btn-secondary text-xs text-danger">Remove</button>
        )}
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" onChange={onPick} className="hidden" />
      </div>
    </div>
  );
}

export default function ToppersForm() {
  const { toast } = useToast();
  const [s, setS] = useState<SiteSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/home");
        const data = await res.json();
        setS(data.ok ? data.settings : DEFAULT_SITE_SETTINGS);
      } catch {
        setS(DEFAULT_SITE_SETTINGS);
      }
    })();
  }, []);

  if (!s) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <div className="skeleton h-10 w-56" />
        <div className="skeleton mt-4 h-64 w-full" />
      </div>
    );
  }

  const toppers = s.toppers || [];
  const setToppers = (next: Topper[]) => setS({ ...s, toppers: next });
  const update = (i: number, patch: Partial<Topper>) => setToppers(toppers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const remove = (i: number) => setToppers(toppers.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= toppers.length) return;
    const next = [...toppers];
    [next[i], next[j]] = [next[j], next[i]];
    setToppers(next.map((t, idx) => ({ ...t, order: idx })));
  };
  const add = () => setToppers([...toppers, newTopper(toppers.length)]);

  async function save() {
    setSaving(true);
    try {
      // Re-sequence order on save so manual reordering persists predictably.
      const ordered = (s!.toppers || []).map((t, idx) => ({ ...t, order: t.order ?? idx }));
      const res = await fetch("/api/admin/home", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toppers: ordered }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) toast("Toppers updated", "success");
      else toast(data.error || "Failed to save", "error");
    } catch {
      toast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormShell title="Toppers / Results" subtitle="Manage the topper cards shown on the Results page and the homepage showcase." backHref={BACK}>
      <Section title="Toppers" desc="Upload a photo (JPG/PNG/WEBP, max 2 MB) and set the rank, name and exam. Photos are optional — entries without a photo show a clean initials avatar.">
        <div className="sm:col-span-2 space-y-3">
          {toppers.length === 0 && <p className="text-sm text-muted">No toppers yet. Add your first one below.</p>}
          {toppers.map((t, i) => (
            <div key={t.id} className="rounded-xl border border-line p-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted">#{i + 1}</span>
                <div className="flex gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="btn btn-secondary px-2 py-1 text-xs disabled:opacity-40">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === toppers.length - 1} className="btn btn-secondary px-2 py-1 text-xs disabled:opacity-40">↓</button>
                  <button type="button" onClick={() => remove(i)} className="btn btn-secondary px-2 py-1 text-xs text-danger">Delete</button>
                </div>
              </div>
              <TopperImage value={t.image_url} onChange={(url) => update(i, { image_url: url })} />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="label">Rank *</label>
                  <input className="input" value={t.rank} onChange={(e) => update(i, { rank: e.target.value })} placeholder="AIR 122" />
                </div>
                <div>
                  <label className="label">Name *</label>
                  <input className="input" value={t.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Shivani" />
                </div>
                <div>
                  <label className="label">Exam</label>
                  <input className="input" value={t.exam || ""} onChange={(e) => update(i, { exam: e.target.value })} placeholder="UPSC CSE 2024" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">Year</label>
                    <input type="number" className="input" value={t.year ?? ""} onChange={(e) => update(i, { year: e.target.value ? Number(e.target.value) : null })} placeholder="2024" />
                  </div>
                  <div>
                    <label className="label">Order</label>
                    <input type="number" className="input" value={t.order ?? i} onChange={(e) => update(i, { order: Number(e.target.value) })} />
                  </div>
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={add} className="btn btn-secondary text-sm">+ Add topper</button>
        </div>
      </Section>

      <FormActions saving={saving} onSave={save} cancelHref={BACK} saveLabel="Save Toppers" />
    </FormShell>
  );
}
