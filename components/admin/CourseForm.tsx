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
import { useToast } from "@/components/ui/Toast";
import { COURSE_CATEGORIES, LEARNING_MODES } from "@/lib/config";
import type { Course, CourseCategory, LearningMode } from "@/lib/types";

const BACK = "/admin/courses";

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

  function toggleMode(m: LearningMode) {
    const cur = c.modes || [];
    set("modes", cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]);
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

                <Section title="Schedule & dates" desc="Reflects on the public course page immediately after saving.">
                  <Field label="Batch start date">
                    <input type="date" className="input" value={c.batch_start ? c.batch_start.slice(0, 10) : ""} onChange={(e) => set("batch_start", e.target.value ? new Date(e.target.value).toISOString() : null)} />
                  </Field>
                  <Field label="Schedule (text)" hint="e.g. Mon–Fri, 7–9 AM IST.">
                    <input className="input" value={c.schedule || ""} onChange={(e) => set("schedule", e.target.value)} />
                  </Field>
                </Section>

                <Section title="Links">
                  <Field label="Brochure link"><input className="input" value={c.brochure_link || ""} onChange={(e) => set("brochure_link", e.target.value)} placeholder="https://…" /></Field>
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
