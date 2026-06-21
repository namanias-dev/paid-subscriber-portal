"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import type {
  FAQItem,
  ContactLink,
  ContactLinkType,
  PdfResource,
  Coupon,
  SeatConfig,
  WhatsAppConfig,
  VideoConfig,
  VideoPlacement,
  MentorInfo,
  SeoConfig,
  Review,
  LearnItem,
  PageSection,
} from "@/lib/types";
import { normalizeIndianMobile } from "@/lib/phone";
import { parseVideo } from "@/lib/videoEmbed";
import RichTextEditor from "@/components/admin/RichTextEditor";

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

// ----------------------------- Seat counter -----------------------------
export function SeatCounterEditor({
  value,
  onChange,
}: {
  value: SeatConfig | undefined;
  onChange: (v: SeatConfig) => void;
}) {
  const v: SeatConfig = value || {};
  const set = (patch: Partial<SeatConfig>) => onChange({ ...v, ...patch });
  const total = v.total ?? null;
  const remaining = v.remaining ?? null;
  const invalid = total != null && remaining != null && remaining > total;

  return (
    <div className="sm:col-span-2 space-y-3">
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={!!v.show} onChange={(e) => set({ show: e.target.checked })} />
        <span className="text-sm"><b>Show seats remaining</b> on the public page (creates urgency).</span>
      </label>
      {v.show && (
        <div className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
          <div>
            <label className="label">Total seats</label>
            <input type="number" min={0} className="input" value={total ?? ""} onChange={(e) => set({ total: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Seats remaining</label>
            <input type="number" min={0} className={`input ${invalid ? "border-danger" : ""}`} value={remaining ?? ""} onChange={(e) => set({ remaining: e.target.value === "" ? null : Number(e.target.value) })} />
            {invalid && <p className="mt-1 text-xs text-danger">Remaining cannot exceed total.</p>}
          </div>
          <div className="sm:col-span-2">
            <label className="label">Custom seats text (optional, overrides the auto line)</label>
            <input className="input" placeholder="e.g. Only a few seats left for this batch" value={v.text_override || ""} onChange={(e) => set({ text_override: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={!!v.show_filling_fast} onChange={(e) => set({ show_filling_fast: e.target.checked })} />
            Show a “Filling Fast” urgency badge
          </label>
          {v.show_filling_fast && (
            <div className="sm:col-span-2">
              <label className="label">Badge text</label>
              <input className="input" placeholder="Seats Filling Fast" value={v.filling_fast_text || ""} onChange={(e) => set({ filling_fast_text: e.target.value })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------- WhatsApp / contact -----------------------------
function PhonePreview({ raw }: { raw: string }) {
  if (!raw.trim()) return null;
  const n = normalizeIndianMobile(raw);
  return n.ok ? (
    <p className="mt-1 text-xs text-success">✓ Saved as {n.display} · wa.me/{n.wa}</p>
  ) : (
    <p className="mt-1 text-xs text-danger">{n.error}</p>
  );
}

export function WhatsAppEditor({
  value,
  onChange,
}: {
  value: WhatsAppConfig | undefined;
  onChange: (v: WhatsAppConfig) => void;
}) {
  const v: WhatsAppConfig = value || {};
  const set = (patch: Partial<WhatsAppConfig>) => onChange({ ...v, ...patch });
  return (
    <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label">WhatsApp number</label>
        <input className="input" placeholder="10-digit mobile (e.g. 9876543210)" value={v.whatsapp || ""} onChange={(e) => set({ whatsapp: e.target.value })} />
        <PhonePreview raw={v.whatsapp || ""} />
      </div>
      <div>
        <label className="label">Contact / call number (optional)</label>
        <input className="input" placeholder="10-digit mobile" value={v.phone || ""} onChange={(e) => set({ phone: e.target.value })} />
        <PhonePreview raw={v.phone || ""} />
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={!!v.show_cta} onChange={(e) => set({ show_cta: e.target.checked })} />
        Show a prominent WhatsApp CTA button on the page
      </label>
      <div>
        <label className="label">CTA button text</label>
        <input className="input" placeholder="WhatsApp Now" value={v.cta_text || ""} onChange={(e) => set({ cta_text: e.target.value })} />
      </div>
      <div>
        <label className="label">Prefilled message (optional)</label>
        <input className="input" placeholder="Hi, I want details about this program" value={v.prefill_message || ""} onChange={(e) => set({ prefill_message: e.target.value })} />
      </div>
    </div>
  );
}

// ----------------------------- Learn items (what you'll learn / get) -----------------------------
export function LearnItemsEditor({
  value,
  onChange,
  addLabel = "+ Add item",
}: {
  value: LearnItem[] | undefined;
  onChange: (v: LearnItem[]) => void;
  addLabel?: string;
}) {
  const items = value || [];
  const update = (i: number, patch: Partial<LearnItem>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  return (
    <div className="sm:col-span-2 space-y-3">
      {items.map((it, i) => (
        <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[70px_1fr_1.4fr_auto] sm:items-center">
          <input className="input text-center" placeholder="🎯" value={it.icon || ""} onChange={(e) => update(i, { icon: e.target.value })} />
          <input className="input" placeholder="Title" value={it.title} onChange={(e) => update(i, { title: e.target.value })} />
          <input className="input" placeholder="Short description (optional)" value={it.desc || ""} onChange={(e) => update(i, { desc: e.target.value })} />
          <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-xs text-danger">Remove</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { title: "", desc: "", icon: "" }])} className="btn btn-secondary text-sm">{addLabel}</button>
    </div>
  );
}

// ----------------------------- String list (who should attend) -----------------------------
export function StringListEditor({
  value,
  onChange,
  placeholder = "Add a point",
  addLabel = "+ Add point",
}: {
  value: string[] | undefined;
  onChange: (v: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  const items = value || [];
  return (
    <div className="sm:col-span-2 space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex gap-2">
          <input className="input" placeholder={placeholder} value={it} onChange={(e) => onChange(items.map((x, idx) => (idx === i ? e.target.value : x)))} />
          <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="btn btn-secondary text-sm text-danger">Remove</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ""])} className="btn btn-secondary text-sm">{addLabel}</button>
    </div>
  );
}

// ----------------------------- Mentor -----------------------------
export function MentorEditor({
  value,
  onChange,
  folder,
}: {
  value: MentorInfo | undefined;
  onChange: (v: MentorInfo) => void;
  folder: string;
}) {
  const v: MentorInfo = value || {};
  const set = (patch: Partial<MentorInfo>) => onChange({ ...v, ...patch });
  return (
    <div className="sm:col-span-2 grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label">Mentor name</label>
        <input className="input" placeholder="e.g. Naman Sharma" value={v.name || ""} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div>
        <label className="label">Credentials / tagline</label>
        <input className="input" placeholder="e.g. Ex-IAS · 8+ yrs mentoring" value={v.credentials || ""} onChange={(e) => set({ credentials: e.target.value })} />
      </div>
      <ImageUploadField label="Mentor photo" value={v.image_url} onChange={(url) => set({ image_url: url })} folder={folder} />
      <div className="sm:col-span-2">
        <label className="label">Mentor bio</label>
        <RichTextEditor value={v.bio} onChange={(html) => set({ bio: html })} placeholder="Mentor bio" />
      </div>
    </div>
  );
}

// ----------------------------- SEO -----------------------------
export function SeoEditor({
  value,
  onChange,
  folder,
}: {
  value: SeoConfig | undefined;
  onChange: (v: SeoConfig) => void;
  folder: string;
}) {
  const v: SeoConfig = value || {};
  const set = (patch: Partial<SeoConfig>) => onChange({ ...v, ...patch });
  return (
    <div className="sm:col-span-2 grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label">SEO title</label>
        <input className="input" placeholder="e.g. UPSC CSE Foundation Course 2026 | Naman IAS" maxLength={70} value={v.title || ""} onChange={(e) => set({ title: e.target.value })} />
        <p className="mt-1 text-xs text-muted">{(v.title || "").length}/70 characters</p>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Meta description</label>
        <textarea className="input" rows={2} maxLength={170} placeholder="Compelling 1-2 line summary with keywords (UPSC, IAS, CSE)…" value={v.description || ""} onChange={(e) => set({ description: e.target.value })} />
        <p className="mt-1 text-xs text-muted">{(v.description || "").length}/170 characters</p>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Keywords (comma separated)</label>
        <input className="input" placeholder="UPSC, IAS coaching, CSE preparation, civil services" value={v.keywords || ""} onChange={(e) => set({ keywords: e.target.value })} />
      </div>
      <ImageUploadField label="Social share image (OG image)" hint="Recommended 1200×630. Falls back to the cover image." value={v.og_image} onChange={(url) => set({ og_image: url })} folder={folder} />
    </div>
  );
}

// ----------------------------- Video section -----------------------------
const PLACEMENTS: { value: VideoPlacement; label: string }[] = [
  { value: "before_about", label: "Before About (recommended)" },
  { value: "after_about", label: "After About" },
  { value: "hero", label: "In Hero" },
];

export function VideoSectionEditor({
  value,
  onChange,
}: {
  value: VideoConfig | undefined;
  onChange: (v: VideoConfig) => void;
}) {
  const v: VideoConfig = value || {};
  const set = (patch: Partial<VideoConfig>) => onChange({ ...v, ...patch });
  const parsed = parseVideo(v.url);
  return (
    <div className="sm:col-span-2 space-y-3">
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={!!v.show} onChange={(e) => set({ show: e.target.checked })} />
        <span className="text-sm"><b>Show a video section</b> (YouTube embed or Instagram reel card).</span>
      </label>
      {v.show && (
        <div className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
          <div>
            <label className="label">Video title</label>
            <input className="input" placeholder="Watch: How this course works" value={v.title || ""} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div>
            <label className="label">Subtitle (optional)</label>
            <input className="input" placeholder="2-minute overview" value={v.subtitle || ""} onChange={(e) => set({ subtitle: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Video URL (YouTube or Instagram)</label>
            <input className="input" placeholder="https://youtu.be/… or https://instagram.com/reel/…" value={v.url || ""} onChange={(e) => set({ url: e.target.value })} />
            {v.url && (
              parsed?.kind === "youtube" ? <p className="mt-1 text-xs text-success">✓ YouTube video detected — will embed inline.</p>
              : parsed?.kind === "instagram" ? <p className="mt-1 text-xs text-success">✓ Instagram link detected — will show a clickable preview card.</p>
              : <p className="mt-1 text-xs text-warning">Unrecognized URL. Use a YouTube or Instagram link.</p>
            )}
          </div>
          <div>
            <label className="label">Placement</label>
            <select className="input" value={v.placement || "before_about"} onChange={(e) => set({ placement: e.target.value as VideoPlacement })}>
              {PLACEMENTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------- Reviews -----------------------------
function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" aria-label={`${n} star`} onClick={() => onChange(n)} className={`text-xl leading-none ${n <= value ? "text-amber-400" : "text-line-strong"}`}>★</button>
      ))}
    </div>
  );
}

export function ReviewsEditor({
  value,
  onChange,
  folder,
}: {
  value: Review[] | undefined;
  onChange: (v: Review[]) => void;
  folder: string;
}) {
  const items = value || [];
  const update = (i: number, patch: Partial<Review>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  return (
    <div className="sm:col-span-2 space-y-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">Review {i + 1}</span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={it.visible !== false} onChange={(e) => update(i, { visible: e.target.checked })} /> Visible</label>
              <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-xs text-danger">Remove</button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input className="input" placeholder="Student name" value={it.name} onChange={(e) => update(i, { name: e.target.value })} />
            </div>
            <div>
              <label className="label">Rating</label>
              <StarPicker value={it.rating || 5} onChange={(n) => update(i, { rating: n })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Review text</label>
              <textarea className="input" rows={2} placeholder="What the student said…" value={it.text} onChange={(e) => update(i, { text: e.target.value })} />
            </div>
            <div>
              <label className="label">Result / rank (optional)</label>
              <input className="input" placeholder="e.g. AIR 351 · UPSC CSE 2024" value={it.result || ""} onChange={(e) => update(i, { result: e.target.value })} />
            </div>
            <div>
              <label className="label">City (optional)</label>
              <input className="input" placeholder="e.g. Jaipur" value={it.city || ""} onChange={(e) => update(i, { city: e.target.value })} />
            </div>
            <div>
              <label className="label">Video testimonial URL (optional)</label>
              <input className="input" placeholder="YouTube / Instagram link" value={it.video_url || ""} onChange={(e) => update(i, { video_url: e.target.value })} />
            </div>
            <ImageUploadField label="Photo (optional)" value={it.photo_url} onChange={(url) => update(i, { photo_url: url })} folder={folder} />
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { name: "", rating: 5, text: "", visible: true }])} className="btn btn-secondary text-sm">+ Add review</button>
    </div>
  );
}

// ----------------------------- Flexible page sections -----------------------------
export function PageSectionsEditor({
  value,
  onChange,
  folder,
}: {
  value: PageSection[] | undefined;
  onChange: (v: PageSection[]) => void;
  folder: string;
}) {
  const items = value || [];
  const update = (i: number, patch: Partial<PageSection>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="sm:col-span-2 space-y-4">
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">Section {i + 1}</span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-xs text-ink2 disabled:opacity-30">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="text-xs text-ink2 disabled:opacity-30">↓</button>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={it.visible !== false} onChange={(e) => update(i, { visible: e.target.checked })} /> Visible</label>
              <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-xs text-danger">Remove</button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Section title</label>
              <input className="input" placeholder="e.g. Why this batch is different" value={it.title} onChange={(e) => update(i, { title: e.target.value })} />
            </div>
            <div>
              <label className="label">Subtitle (optional)</label>
              <input className="input" value={it.subtitle || ""} onChange={(e) => update(i, { subtitle: e.target.value })} />
            </div>
          </div>
          <div className="mt-2">
            <label className="label">Content</label>
            <RichTextEditor value={it.content} onChange={(html) => update(i, { content: html })} placeholder="Section content" />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <ImageUploadField label="Section image (optional)" value={it.image_url} onChange={(url) => update(i, { image_url: url })} folder={folder} />
            <div className="self-start">
              <label className="label">Video URL (optional)</label>
              <input className="input" placeholder="YouTube / Instagram link" value={it.video_url || ""} onChange={(e) => update(i, { video_url: e.target.value })} />
            </div>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { title: "", content: "", visible: true, order: items.length }])} className="btn btn-secondary text-sm">+ Add custom section</button>
    </div>
  );
}
