"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import type { FAQItem, ContactLink, ContactLinkType, PdfResource, Coupon } from "@/lib/types";

/** Upload a file to Supabase Storage via the admin route. Returns the public URL. */
async function uploadFile(file: File, folder: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", folder);
  const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
  return res.json().catch(() => ({ ok: false, error: "Upload failed." }));
}

// ----------------------------- Image upload -----------------------------
export function ImageUploadField({
  label,
  hint,
  value,
  onChange,
  folder,
}: {
  label: string;
  hint?: string;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  folder: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const r = await uploadFile(file, folder);
    setBusy(false);
    if (r.ok && r.url) {
      onChange(r.url);
      toast("Image uploaded", "success");
    } else {
      toast(r.error || "Upload failed", "error");
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="sm:col-span-2">
      <label className="label">{label}</label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="relative h-28 w-44 shrink-0 overflow-hidden rounded-xl border border-line bg-surface2">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="preview" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted">No image</div>
          )}
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="btn btn-secondary text-sm">
              {busy ? "Uploading…" : value ? "Replace" : "Upload"}
            </button>
            {value && (
              <button type="button" onClick={() => onChange(null)} className="btn btn-secondary text-sm text-danger">Remove</button>
            )}
          </div>
          <input ref={inputRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
          <input
            className="input text-xs"
            placeholder="…or paste an image URL"
            value={value || ""}
            onChange={(e) => onChange(e.target.value || null)}
          />
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

// ----------------------------- FAQs -----------------------------
export function FaqEditor({ value, onChange }: { value: FAQItem[]; onChange: (v: FAQItem[]) => void }) {
  const items = value || [];
  const update = (i: number, patch: Partial<FAQItem>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  return (
    <div className="sm:col-span-2 space-y-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">FAQ {i + 1}</span>
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-xs text-danger">Remove</button>
          </div>
          <input className="input mb-2" placeholder="Question" value={it.q} onChange={(e) => update(i, { q: e.target.value })} />
          <textarea className="input" rows={2} placeholder="Answer" value={it.a} onChange={(e) => update(i, { a: e.target.value })} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { q: "", a: "" }])} className="btn btn-secondary text-sm">+ Add FAQ</button>
    </div>
  );
}

// ----------------------------- Contact links -----------------------------
const CONTACT_TYPES: ContactLinkType[] = ["whatsapp", "phone", "email", "telegram", "website"];
const CONTACT_PLACEHOLDER: Record<ContactLinkType, string> = {
  whatsapp: "91XXXXXXXXXX (digits only)",
  phone: "+91 98xxxxxxxx",
  email: "name@example.com",
  telegram: "https://t.me/yourchannel",
  website: "https://…",
};

export function ContactLinksEditor({ value, onChange }: { value: ContactLink[]; onChange: (v: ContactLink[]) => void }) {
  const items = value || [];
  const update = (i: number, patch: Partial<ContactLink>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  return (
    <div className="sm:col-span-2 space-y-3">
      {items.map((it, i) => (
        <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[140px_1fr_1fr_auto] sm:items-center">
          <select className="input" value={it.type} onChange={(e) => update(i, { type: e.target.value as ContactLinkType })}>
            {CONTACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="input" placeholder={CONTACT_PLACEHOLDER[it.type]} value={it.value} onChange={(e) => update(i, { value: e.target.value })} />
          <input className="input" placeholder="Button label (optional)" value={it.label || ""} onChange={(e) => update(i, { label: e.target.value })} />
          <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-xs text-danger">Remove</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { type: "whatsapp", value: "" }])} className="btn btn-secondary text-sm">+ Add contact link</button>
    </div>
  );
}

// ----------------------------- PDF resources -----------------------------
export function PdfResourcesEditor({ value, onChange, folder }: { value: PdfResource[]; onChange: (v: PdfResource[]) => void; folder: string }) {
  const { toast } = useToast();
  const items = value || [];
  const [busy, setBusy] = useState<number | null>(null);
  const update = (i: number, patch: Partial<PdfResource>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  async function onPick(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(i);
    const r = await uploadFile(file, folder);
    setBusy(null);
    if (r.ok && r.url) {
      update(i, { url: r.url, label: items[i].label || file.name.replace(/\.pdf$/i, "") });
      toast("PDF uploaded", "success");
    } else {
      toast(r.error || "Upload failed", "error");
    }
    e.target.value = "";
  }

  return (
    <div className="sm:col-span-2 space-y-3">
      {items.map((it, i) => (
        <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <input className="input" placeholder="Resource title (e.g. Bonus Notes PDF)" value={it.label} onChange={(e) => update(i, { label: e.target.value })} />
          <label className="btn btn-secondary cursor-pointer text-sm">
            {busy === i ? "Uploading…" : it.url ? "Replace PDF" : "Upload PDF"}
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => onPick(i, e)} />
          </label>
          <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-xs text-danger">Remove</button>
          <input className="input text-xs sm:col-span-3" placeholder="PDF URL" value={it.url} onChange={(e) => update(i, { url: e.target.value })} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { label: "", url: "" }])} className="btn btn-secondary text-sm">+ Add PDF resource</button>
    </div>
  );
}

// ----------------------------- Coupons -----------------------------
export function CouponsEditor({ value, onChange }: { value: Coupon[]; onChange: (v: Coupon[]) => void }) {
  const items = value || [];
  const update = (i: number, patch: Partial<Coupon>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  return (
    <div className="sm:col-span-2 space-y-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">Coupon {i + 1}{it.used ? ` · used ${it.used}×` : ""}</span>
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-xs text-danger">Remove</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Code</label>
              <input className="input uppercase" placeholder="EARLYBIRD" value={it.code} onChange={(e) => update(i, { code: e.target.value.toUpperCase().replace(/\s+/g, "") })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Type</label>
                <select className="input" value={it.type} onChange={(e) => update(i, { type: e.target.value as Coupon["type"] })}>
                  <option value="percent">% off</option>
                  <option value="flat">₹ flat</option>
                </select>
              </div>
              <div>
                <label className="label">Value</label>
                <input type="number" className="input" min={0} value={it.value} onChange={(e) => update(i, { value: Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <label className="label">Expiry (optional)</label>
              <input type="date" className="input" value={it.expires_at ? it.expires_at.slice(0, 10) : ""} onChange={(e) => update(i, { expires_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </div>
            <div>
              <label className="label">Max uses (optional)</label>
              <input type="number" className="input" min={0} value={it.max_uses ?? ""} onChange={(e) => update(i, { max_uses: e.target.value ? Number(e.target.value) : null })} />
            </div>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={it.active !== false} onChange={(e) => update(i, { active: e.target.checked })} /> Active
          </label>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { code: "", type: "percent", value: 10, active: true, used: 0 }])} className="btn btn-secondary text-sm">+ Add coupon</button>
    </div>
  );
}

// ----------------------------- Active toggle -----------------------------
export function ActiveToggle({ active, onChange }: { active: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 sm:col-span-2">
      <input type="checkbox" checked={active} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">
        <b>{active ? "Active" : "Disabled"}</b> — {active ? "visible on the public site." : "hidden from the public site (kept in admin)."}
      </span>
    </label>
  );
}
