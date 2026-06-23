"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormShell, Section, Field, FormActions, Tabs } from "./FormKit";
import {
  ImageUploadField,
  FaqEditor,
  ContactLinksEditor,
  PdfResourcesEditor,
  CouponsEditor,
  ActiveToggle,
  SeatCounterEditor,
  WhatsAppEditor,
  VideoSectionEditor,
  LearnItemsEditor,
  StringListEditor,
  MentorEditor,
  SeoEditor,
  ReviewsEditor,
  PageSectionsEditor,
} from "./FormFields";
import RichTextEditor from "./RichTextEditor";
import LibraryPicker from "./LibraryPicker";
import { useToast } from "@/components/ui/Toast";
import { COURSE_CATEGORIES, LEARNING_MODES } from "@/lib/config";
import { istInputToISO, isoToISTInput, formatINR, formatISTDate } from "@/lib/dates";
import { resolveEmiConfig, buildSchedule, EMI_DEFAULTS } from "@/lib/installments";
import type { Course, CourseCategory, LearningMode, CourseAfterRegistration, OrientationVideo, CourseEmiConfig } from "@/lib/types";

const BACK = "/admin/courses";
const BATCH_TIMINGS = ["Morning", "Afternoon", "Evening", "Weekend"];

export default function CourseForm({ course }: { course?: Course }) {
  const router = useRouter();
  const { toast } = useToast();
  const isNew = !course?.id;

  const [c, setC] = useState<Partial<Course>>(
    course || {
      title: "", category: "Foundation", description: "", long_description: "", modes: ["Online"],
      price: 0, original_price: null, language: "Hinglish (Bilingual)", target_years: "2026/27",
      duration: "12 months", faculty: "Naman Sir", status: "draft", emi_amount: null, emi_months: null,
      brochure_link: "", razorpay_link: "", featured: false, included: [], not_included: [],
    }
  );
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Course, v: unknown) => setC((p) => ({ ...p, [k]: v }));

  const ar: CourseAfterRegistration = c.after_registration || {};
  const setAR = (k: keyof CourseAfterRegistration, v: unknown) => set("after_registration", { ...ar, [k]: v });

  function toggleMode(m: LearningMode) {
    const cur = c.modes || [];
    set("modes", cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]);
  }

  function toggleTiming(t: string) {
    const cur = c.batch_timings || [];
    set("batch_timings", cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);
  }

  async function save() {
    if (!c.title?.trim()) return toast("Title is required", "error");
    setSaving(true);
    const res = await fetch(isNew ? "/api/admin/courses" : `/api/admin/courses/${course!.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (data.ok) {
      toast(isNew ? "Course created" : "Course updated", "success");
      router.push(BACK);
      router.refresh();
    } else {
      toast(data.error || "Failed to save", "error");
    }
  }

  return (
    <FormShell
      title={isNew ? "Create New Course" : "Edit Course"}
      subtitle="Auto-generates a public course & checkout page at /courses/<slug>"
      backHref={BACK}
    >
      <Tabs
        items={[
          {
            id: "basic",
            label: "Basic Details",
            content: (
              <>
                <Section title="Basics">
                  <Field label="Title" full>
                    <input className="input" value={c.title || ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. GS Foundation 2027" />
                  </Field>
                  <Field label="Category">
                    <select className="input" value={c.category} onChange={(e) => set("category", e.target.value as CourseCategory)}>
                      {COURSE_CATEGORIES.map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select className="input" value={c.status} onChange={(e) => set("status", e.target.value)}>
                      <option value="draft">Draft (hidden)</option>
                      <option value="published">Published (live)</option>
                      <option value="closed">Closed</option>
                    </select>
                  </Field>
                  <Field label="Hero badge label (optional)" hint='Falls back to category, e.g. "Foundation".'>
                    <input className="input" value={c.badge_label || ""} onChange={(e) => set("badge_label", e.target.value)} placeholder="Foundation Course" />
                  </Field>
                  <Field label="Short description" full hint="One or two lines shown on cards.">
                    <textarea className="input" rows={2} value={c.description || ""} onChange={(e) => set("description", e.target.value)} />
                  </Field>
                  <Field label="Modes" full>
                    <div className="flex flex-wrap gap-2">
                      {LEARNING_MODES.map((m) => (
                        <button key={m} type="button" onClick={() => toggleMode(m as LearningMode)} className={`chip ${(c.modes || []).includes(m as LearningMode) ? "chip-active" : ""}`}>{m}</button>
                      ))}
                    </div>
                  </Field>
                  <ActiveToggle active={c.active !== false} onChange={(v) => set("active", v)} />
                </Section>

                <Section title="Details">
                  <Field label="Language"><input className="input" value={c.language || ""} onChange={(e) => set("language", e.target.value)} /></Field>
                  <Field label="Target years"><input className="input" value={c.target_years || ""} onChange={(e) => set("target_years", e.target.value)} /></Field>
                  <Field label="Duration"><input className="input" value={c.duration || ""} onChange={(e) => set("duration", e.target.value)} /></Field>
                  <Field label="Faculty"><input className="input" value={c.faculty || ""} onChange={(e) => set("faculty", e.target.value)} /></Field>
                  <Field label="What's included" full hint="Comma separated.">
                    <input className="input" value={(c.included || []).join(", ")} onChange={(e) => set("included", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
                  </Field>
                </Section>

                <Section title="Schedule & dates" desc="All times are treated and displayed in IST. Reflects on the public course page after saving.">
                  <Field label="Batch start date (IST)" hint="Drives the public countdown timer.">
                    <input type="date" className="input" value={c.batch_start ? isoToISTInput(c.batch_start).slice(0, 10) : ""} onChange={(e) => set("batch_start", e.target.value ? istInputToISO(`${e.target.value}T00:00`) : null)} />
                  </Field>
                  <Field label="Schedule (text)" hint="e.g. Mon–Sat, 10:00 AM–1:00 PM IST.">
                    <input className="input" value={c.schedule || ""} onChange={(e) => set("schedule", e.target.value)} />
                  </Field>
                  <Field label="Batch timing" full hint="Structured tags shown on the course card (select any).">
                    <div className="flex flex-wrap gap-2">
                      {BATCH_TIMINGS.map((t) => (
                        <button key={t} type="button" onClick={() => toggleTiming(t)} className={`chip ${(c.batch_timings || []).includes(t) ? "chip-active" : ""}`}>{t}</button>
                      ))}
                    </div>
                  </Field>
                </Section>

                <Section title="Brochures" desc="Pick from the shared Brochure Library — upload once, reuse across courses.">
                  <Field label="Attached brochures" full>
                    <LibraryPicker value={c.brochure_ids || []} onChange={(ids) => set("brochure_ids", ids)} hint="Shown as premium download cards on the public course page." />
                  </Field>
                </Section>

                <Section title="Links">
                  <Field label="Razorpay link"><input className="input" value={c.razorpay_link || ""} onChange={(e) => set("razorpay_link", e.target.value)} placeholder="https://…" /></Field>
                  <Field label="Options" full>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.featured} onChange={(e) => set("featured", e.target.checked)} /> Featured on homepage</label>
                  </Field>
                </Section>
              </>
            ),
          },
          {
            id: "pricing",
            label: "Pricing & Seats",
            content: (
              <>
                <Section title="Pricing">
                  <Field label="Price (₹)"><input type="number" className="input" value={c.price ?? 0} onChange={(e) => set("price", Number(e.target.value))} /></Field>
                  <Field label="Original price (₹)" hint="Optional — shows a strikethrough."><input type="number" className="input" value={c.original_price ?? ""} onChange={(e) => set("original_price", e.target.value ? Number(e.target.value) : null)} /></Field>
                  <Field label="EMI / month (₹)"><input type="number" className="input" value={c.emi_amount ?? ""} onChange={(e) => set("emi_amount", e.target.value ? Number(e.target.value) : null)} /></Field>
                  <Field label="EMI months"><input type="number" className="input" value={c.emi_months ?? ""} onChange={(e) => set("emi_months", e.target.value ? Number(e.target.value) : null)} /></Field>
                </Section>
                <Section title="Seats remaining" desc="Admin-controlled. When off, no seats line appears on the public page.">
                  <SeatCounterEditor value={c.seat_config} onChange={(v) => set("seat_config", v)} />
                </Section>
                <Section title="Book Your Seat + EMI" desc="Let students secure a seat with a small amount and pay the rest in installments. The full fee above is used as the grand total.">
                  <EmiConfigEditor total={c.price ?? 0} value={c.emi_config || {}} onChange={(v) => set("emi_config", v)} />
                </Section>
                <Section title="Coupons" desc="Discount codes students can apply at checkout.">
                  <CouponsEditor value={c.coupons || []} onChange={(v) => set("coupons", v)} />
                </Section>
              </>
            ),
          },
          {
            id: "media",
            label: "Media",
            content: (
              <>
                <Section title="Cover image" desc="Used on the course page and social share cards (Open Graph).">
                  <ImageUploadField label="Primary cover image" folder="covers" value={c.cover_image_url} onChange={(v) => set("cover_image_url", v)} hint="Recommended 1200×630 (16:9 / wide)." />
                  <ImageUploadField label="Mobile image (optional)" folder="covers/mobile" value={c.mobile_image_url} onChange={(v) => set("mobile_image_url", v)} hint="Optional portrait/square crop. Falls back to the primary image." />
                </Section>
                <Section title="Video" desc="Embed a YouTube video or link an Instagram reel.">
                  <VideoSectionEditor value={c.video_config} onChange={(v) => set("video_config", v)} />
                </Section>
                <Section title="Downloadable resources" desc="Bonus PDFs / syllabus attached to this course.">
                  <PdfResourcesEditor value={c.pdf_resources || []} onChange={(v) => set("pdf_resources", v)} folder="resources" />
                </Section>
              </>
            ),
          },
          {
            id: "content",
            label: "Rich Content",
            content: (
              <>
                <Section title="About this course" desc="Rich formatting — headings, lists, images, links, tables.">
                  <Field label="About (rich text)" full>
                    <RichTextEditor value={c.about_html} onChange={(html) => set("about_html", html)} placeholder="Describe the course in detail…" />
                  </Field>
                  <Field label="Plain fallback description (optional)" full hint="Used only if the rich About above is empty.">
                    <textarea className="input" rows={4} value={c.long_description || ""} onChange={(e) => set("long_description", e.target.value)} />
                  </Field>
                </Section>
                <Section title="What you'll learn" desc="Icon cards highlighting key takeaways.">
                  <LearnItemsEditor value={c.what_you_learn} onChange={(v) => set("what_you_learn", v)} addLabel="+ Add learning point" />
                </Section>
                <Section title="Who should join">
                  <StringListEditor value={c.who_should_attend} onChange={(v) => set("who_should_attend", v)} placeholder="e.g. Working professionals targeting UPSC 2027" addLabel="+ Add audience point" />
                </Section>
                <Section title="What you'll get" desc="Deliverables / bonuses included.">
                  <LearnItemsEditor value={c.what_you_get} onChange={(v) => set("what_you_get", v)} addLabel="+ Add deliverable" />
                </Section>
                <Section title="Mentor / faculty">
                  <MentorEditor value={c.mentor} onChange={(v) => set("mentor", v)} folder="mentors" />
                </Section>
                <Section title="FAQs">
                  <FaqEditor value={c.faqs || []} onChange={(v) => set("faqs", v)} />
                </Section>
                <Section title="Custom sections" desc="Optional flexible blocks rendered after the main content.">
                  <PageSectionsEditor value={c.sections} onChange={(v) => set("sections", v)} folder="sections" />
                </Section>
              </>
            ),
          },
          {
            id: "reviews",
            label: "Reviews",
            content: (
              <Section title="Reviews & testimonials" desc="Build trust with student results and ratings.">
                <ReviewsEditor value={c.reviews} onChange={(v) => set("reviews", v)} folder="reviews" />
              </Section>
            ),
          },
          {
            id: "after",
            label: "After Registration",
            content: (
              <>
                <Section title="Welcome message" desc="Shown at the top of the enrolled student's Class Hub.">
                  <Field label="Welcome (rich text)" full>
                    <RichTextEditor value={ar.welcome_html} onChange={(html) => setAR("welcome_html", html)} placeholder="Thanks for enrolling — welcome, future officer!" />
                  </Field>
                </Section>
                <Section title="Live class (Zoom)" desc="Same pattern as webinars. Times are IST.">
                  <Field label="Zoom / live-class link"><input className="input" value={ar.zoom_link || ""} onChange={(e) => setAR("zoom_link", e.target.value)} placeholder="https://zoom.us/j/…" /></Field>
                  <Field label="Join note (passcode / instructions)"><input className="input" value={ar.zoom_note || ""} onChange={(e) => setAR("zoom_note", e.target.value)} placeholder="e.g. Passcode: 1234" /></Field>
                  <Field label="Class timing (text, IST)"><input className="input" value={ar.class_timing || ""} onChange={(e) => setAR("class_timing", e.target.value)} placeholder="Mon–Sat, 7–9 AM" /></Field>
                  <Field label="Next class (IST)" hint="Optional — drives the countdown in the Class Hub.">
                    <input type="datetime-local" className="input" value={isoToISTInput(ar.next_class_at)} onChange={(e) => setAR("next_class_at", e.target.value ? istInputToISO(e.target.value) : null)} />
                  </Field>
                </Section>
                <Section title="Orientation videos" desc="Paste YouTube URLs — responsive embeds in the Class Hub.">
                  <VideosEditor value={ar.videos || []} onChange={(v) => setAR("videos", v)} />
                </Section>
                <Section title="Study material" desc="Pick PDFs from the shared library (no re-upload).">
                  <LibraryPicker value={ar.doc_ids || []} onChange={(ids) => setAR("doc_ids", ids)} hint="Downloadable by enrolled students in their Class Hub." />
                </Section>
                <Section title="Content blocks" desc="Reorderable blocks (prep checklist, do's & don'ts, contact). Heading + rich text + media.">
                  <PageSectionsEditor value={ar.blocks} onChange={(v) => setAR("blocks", v)} folder="sections" />
                </Section>
              </>
            ),
          },
          {
            id: "seo",
            label: "SEO",
            content: (
              <Section title="Search & social" desc="Controls Google title, description and share previews.">
                <SeoEditor value={c.seo} onChange={(v) => set("seo", v)} folder="seo" />
              </Section>
            ),
          },
          {
            id: "contact",
            label: "Contact / WhatsApp",
            content: (
              <>
                <Section title="WhatsApp & contact" desc="Numbers are auto-normalized to +91 — fixes broken wa.me links.">
                  <WhatsAppEditor value={c.whatsapp_config} onChange={(v) => set("whatsapp_config", v)} />
                </Section>
                <Section title="Additional contact links" desc="Extra WhatsApp / phone / email / telegram buttons.">
                  <ContactLinksEditor value={c.contact_links || []} onChange={(v) => set("contact_links", v)} />
                </Section>
              </>
            ),
          },
        ]}
      />

      <FormActions saving={saving} onSave={save} cancelHref={BACK} saveLabel={isNew ? "Create Course" : "Save Changes"} />
    </FormShell>
  );
}

function VideosEditor({ value, onChange }: { value: OrientationVideo[]; onChange: (v: OrientationVideo[]) => void }) {
  const items = value || [];
  const update = (i: number, patch: Partial<OrientationVideo>) => onChange(items.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  return (
    <div className="space-y-3">
      {items.map((v, i) => (
        <div key={i} className="rounded-xl border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input text-sm" value={v.title || ""} onChange={(e) => update(i, { title: e.target.value })} placeholder="Title (e.g. Orientation)" />
            <input className="input text-sm" value={v.url} onChange={(e) => update(i, { url: e.target.value })} placeholder="YouTube URL" />
          </div>
          <input className="input mt-2 text-sm" value={v.description || ""} onChange={(e) => update(i, { description: e.target.value })} placeholder="Short description (optional)" />
          <button type="button" onClick={() => remove(i)} className="mt-2 text-xs text-danger">Remove</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { url: "", title: "", description: "" }])} className="btn btn-secondary text-sm">+ Add video</button>
    </div>
  );
}

function EmiConfigEditor({ total, value, onChange }: { total: number; value: CourseEmiConfig; onChange: (v: CourseEmiConfig) => void }) {
  const v = value || {};
  const set = (k: keyof CourseEmiConfig, val: unknown) => onChange({ ...v, [k]: val });
  const cfg = resolveEmiConfig({ emi_config: v, price: total });

  // Live preview: sample seat + first enabled installment count.
  const sampleSeat = cfg.seatAmount ?? cfg.minSeatAmount ?? Math.min(2000, Math.max(1, Math.round(total * 0.1)));
  const sampleCount = cfg.installmentCounts[0] || 6;
  const preview =
    total > 1 && sampleSeat < total
      ? buildSchedule({
          total,
          seatAmount: sampleSeat,
          count: sampleCount,
          bookingISO: new Date().toISOString(),
          firstIntervalDays: cfg.firstIntervalDays,
          intervalMonths: cfg.intervalMonths,
        })
      : [];
  const grand = preview.reduce((a, s) => a + s.amount, 0);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={!!v.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        Enable “Book Your Seat + EMI” for this course
      </label>

      {v.enabled && (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.allow_full !== false} onChange={(e) => set("allow_full", e.target.checked)} />
            Also allow one-time “Pay Full” option
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Seat amount (₹)" hint="Amount to secure a seat, deducted from total.">
              <input type="number" className="input" value={v.seat_amount ?? ""} onChange={(e) => set("seat_amount", e.target.value ? Number(e.target.value) : null)} />
            </Field>
            <Field label="Best-value note (optional)" hint="Shown on the Pay-Full card.">
              <input className="input" value={v.best_value_note ?? ""} onChange={(e) => set("best_value_note", e.target.value)} placeholder="e.g. Save more" />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!v.allow_custom_seat} onChange={(e) => set("allow_custom_seat", e.target.checked)} />
            Let students enter a custom seat amount (with a minimum)
          </label>
          {v.allow_custom_seat && (
            <Field label="Minimum seat amount (₹)">
              <input type="number" className="input" value={v.min_seat_amount ?? ""} onChange={(e) => set("min_seat_amount", e.target.value ? Number(e.target.value) : null)} />
            </Field>
          )}

          <Field label="Installment counts" hint="Comma-separated, e.g. 3, 6, 10">
            <input
              className="input"
              value={(v.installment_counts || EMI_DEFAULTS.installment_counts).join(", ")}
              onChange={(e) => set("installment_counts", e.target.value.split(",").map((s) => Math.round(Number(s.trim()))).filter((n) => n >= 1))}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First installment after (days)" hint="Default 7">
              <input type="number" className="input" value={v.first_interval_days ?? ""} onChange={(e) => set("first_interval_days", e.target.value ? Number(e.target.value) : null)} placeholder="7" />
            </Field>
            <Field label="Then every (months)" hint="Default 1 (monthly)">
              <input type="number" className="input" value={v.interval_months ?? ""} onChange={(e) => set("interval_months", e.target.value ? Number(e.target.value) : null)} placeholder="1" />
            </Field>
          </div>

          {/* Live preview */}
          {preview.length > 0 && (
            <div className="rounded-xl border border-line bg-surface2 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Student preview · seat {formatINR(sampleSeat)} · {sampleCount} months</p>
              <div className="mt-2 space-y-1 text-sm">
                {preview.map((s) => (
                  <div key={s.no} className="flex items-center justify-between">
                    <span>{s.no === 0 ? "Today — Book Your Seat" : `${s.label} · ${formatISTDate(s.due)}`}</span>
                    <span className="font-semibold">{formatINR(s.amount)}</span>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between border-t border-line pt-1 font-semibold">
                  <span>Grand total (must equal fee)</span>
                  <span className={grand === total ? "text-success" : "text-danger"}>{formatINR(grand)}{grand === total ? " ✓" : ` ≠ ${formatINR(total)}`}</span>
                </div>
              </div>
            </div>
          )}
          {total <= 1 && <p className="text-xs text-danger">Set a course price above to preview the EMI schedule.</p>}
        </div>
      )}
    </div>
  );
}
