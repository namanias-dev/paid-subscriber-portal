"use client";

import { useEffect, useState } from "react";
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
import OrientationVideoPicker from "./OrientationVideoPicker";
import { useToast } from "@/components/ui/Toast";
import { COURSE_CATEGORIES, LEARNING_MODES } from "@/lib/config";
import { istInputToISO, isoToISTInput, formatINR, formatISTDate } from "@/lib/dates";
import { resolveEmiConfig, buildSchedule, EMI_DEFAULTS, batchModes, batchTimings, batchModeLabel, batchTimingLabel } from "@/lib/installments";
import type { Course, CourseCategory, LearningMode, CourseAfterRegistration, OrientationVideo, CourseEmiConfig, CourseEntitlements, CourseBatch } from "@/lib/types";

const BACK = "/admin/courses";
const BATCH_TIMINGS = ["Morning", "Afternoon", "Evening", "Weekend"];

export default function CourseForm({ course }: { course?: Course }) {
  const router = useRouter();
  const { toast } = useToast();
  const isNew = !course?.id;

  const [c, setC] = useState<Partial<Course>>(() => {
    if (course) return course;
    // New course: seed exactly ONE starter batch so schedule + pricing have a
    // single home from the very first save (one batch = one offering).
    const starter = makeStarterBatch({ modes: ["Online"], price: 0 });
    return {
      title: "", category: "Foundation", description: "", long_description: "", modes: ["Online"],
      price: 0, original_price: null, language: "Hinglish (Bilingual)", target_years: "2026/27",
      duration: "12 months", faculty: "Naman Sir", status: "draft", emi_amount: null, emi_months: null,
      brochure_link: "", razorpay_link: "", featured: false, included: [], not_included: [],
      show_included: true, show_not_included: true,
      batches: [starter], default_batch_id: starter.id,
    };
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Course, v: unknown) => setC((p) => ({ ...p, [k]: v }));

  const ar: CourseAfterRegistration = c.after_registration || {};
  const setAR = (k: keyof CourseAfterRegistration, v: unknown) => set("after_registration", { ...ar, [k]: v });

  // The default batch is the single source of truth for schedule + pricing. The
  // course-level fields are auto-derived from it on save (below) so every existing
  // downstream consumer (planCourseEnrollment fallback, cards, course detail) keeps
  // working with no change. The Basic Details / Pricing tabs only SHOW these.
  const batchesNow = c.batches || [];
  const defaultBatchNow =
    batchesNow.find((b) => b.id === c.default_batch_id) || batchesNow[0] || null;

  /** Course-level fields derived from the default batch (schedule + pricing). */
  function deriveCourseFromDefault(course: Partial<Course>): Partial<Course> {
    const list = course.batches || [];
    const def = list.find((b) => b.id === course.default_batch_id) || list[0];
    if (!def) return course; // no batches → leave course-level fields untouched
    return {
      ...course,
      default_batch_id: def.id,
      modes: batchModes(def),
      batch_timings: batchTimings(def),
      batch_start: def.start_date ?? null,
      price: def.price ?? 0,
      original_price: def.original_price ?? null,
      pay_in_full_price: def.pay_in_full_price ?? null,
      emi_config: def.emi_config ?? {},
      capacity: def.capacity ?? null,
      seats_left: def.seats_left ?? null,
    };
  }

  async function save() {
    if (!c.title?.trim()) return toast("Title is required", "error");
    const cleanList = (v: string[] | undefined) => (v || []).map((s) => s.trim()).filter(Boolean);
    const payload = deriveCourseFromDefault({
      ...c,
      included: cleanList(c.included),
      not_included: cleanList(c.not_included),
    });
    setSaving(true);
    const res = await fetch(isNew ? "/api/admin/courses" : `/api/admin/courses/${course!.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
                  <ActiveToggle active={c.active !== false} onChange={(v) => set("active", v)} />
                </Section>

                <Section title="Details">
                  <Field label="Language"><input className="input" value={c.language || ""} onChange={(e) => set("language", e.target.value)} /></Field>
                  <Field label="Target years"><input className="input" value={c.target_years || ""} onChange={(e) => set("target_years", e.target.value)} /></Field>
                  <Field label="Duration"><input className="input" value={c.duration || ""} onChange={(e) => set("duration", e.target.value)} /></Field>
                  <Field label="Faculty"><input className="input" value={c.faculty || ""} onChange={(e) => set("faculty", e.target.value)} /></Field>
                  <div className="sm:col-span-2 text-xs text-[var(--ca-slate-500)]">Edit &ldquo;What&apos;s included&rdquo; &amp; &ldquo;What&apos;s not included&rdquo; (with show/hide) in the <b>Rich Content</b> tab.</div>
                </Section>

                <Section title="Schedule, modes & dates" desc="Mode, timing, start date, price, EMI and seats are now set per BATCH — go to the Batches tab. The values below are auto-derived from the default batch on save (read-only here) so there's a single source of truth and no double entry.">
                  <Field label="Schedule (text)" hint="Free-text shown on the public page, e.g. Mon–Sat, 10:00 AM–1:00 PM IST.">
                    <input className="input" value={c.schedule || ""} onChange={(e) => set("schedule", e.target.value)} />
                  </Field>
                  <div className="sm:col-span-2">
                    <DerivedScheduleSummary batch={defaultBatchNow} />
                  </div>
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
                <Section title="Price, EMI & seats — set per batch" desc="Each batch carries its own price, pay-in-full, EMI plan and seats in the Batches tab. The course-level price shown below is auto-derived from the default batch on save (single source of truth — no double entry).">
                  <div className="sm:col-span-2">
                    <DerivedPricingSummary batch={defaultBatchNow} />
                  </div>
                </Section>
                <Section title="Seats remaining (public display)" desc="Optional marketing display on the public page. Independent of per-batch seat counts. When off, no seats line appears.">
                  <SeatCounterEditor value={c.seat_config} onChange={(v) => set("seat_config", v)} />
                </Section>
                <Section title="Coupons" desc="Discount codes students can apply at checkout.">
                  <CouponsEditor value={c.coupons || []} onChange={(v) => set("coupons", v)} />
                </Section>
              </>
            ),
          },
          {
            id: "batches",
            label: "Batches",
            content: (
              <Section
                title="Batches — one batch = one offering"
                desc="The single source of truth for schedule + pricing. Each batch = one mode + one timing + one start date + its own price / pay-in-full / EMI / seats. Students pick a batch on the enroll page. The DEFAULT batch fills the course-level price & dates used everywhere else. Even a simple course is just one batch."
              >
                <BatchesEditor
                  course={c}
                  value={c.batches || []}
                  defaultId={c.default_batch_id ?? null}
                  onChange={(batches, defaultId) => setC((p) => ({ ...p, batches, default_batch_id: defaultId }))}
                />
              </Section>
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
                <Section title="What's included" desc="Bullet points shown on the public course page. Add, edit, reorder or remove items. Turn the section off to hide it entirely.">
                  <div className="sm:col-span-2 mb-1">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={c.show_included !== false} onChange={(e) => set("show_included", e.target.checked)} />
                      Show &ldquo;What&apos;s included&rdquo; on the public page
                    </label>
                  </div>
                  <StringListEditor value={c.included} onChange={(v) => set("included", v)} placeholder="e.g. Live + recorded lectures" addLabel="+ Add included item" reorderable />
                </Section>
                <Section title="What's not included" desc="Optional. Leave empty or switch off to remove this section from the public course page.">
                  <div className="sm:col-span-2 mb-1">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={c.show_not_included !== false} onChange={(e) => set("show_not_included", e.target.checked)} />
                      Show &ldquo;What&apos;s not included&rdquo; on the public page
                    </label>
                  </div>
                  <StringListEditor value={c.not_included} onChange={(v) => set("not_included", v)} placeholder="e.g. Printed material (shipping extra)" addLabel="+ Add not-included item" reorderable />
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
                <Section title="Orientation & starter videos" desc="Reuse videos from the Content library — uploaded once, assignable to many courses & webinars. Changes here save instantly.">
                  {isNew ? (
                    <p className="rounded-xl border border-dashed border-line bg-surface2/40 px-3 py-4 text-sm text-muted">
                      Save the course first, then link library videos here.
                    </p>
                  ) : (
                    <OrientationVideoPicker targetType="course" targetId={course!.id} />
                  )}
                </Section>
                <Section title="One-off video URLs (legacy)" desc="Paste a YouTube URL that isn't in the library. Prefer the library picker above so a video can be reused across courses.">
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
            id: "access",
            label: "Access & Entitlements",
            content: (
              <Section title="Mission Control" desc="Decide EXACTLY what enrolling in this course unlocks. Enrolled, logged-in students get this access automatically — no lead form, no re-asking.">
                <EntitlementsEditor value={c.entitlements || {}} onChange={(v) => set("entitlements", v)} />
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

type QuizLite = { id: string; title: string; requires_payment?: boolean };
type CaPdfLite = { id: string; title: string; is_free?: boolean };

/** "Mission Control": choose exactly what a course unlocks. Single source of truth for the central entitlement check. */
function EntitlementsEditor({ value, onChange }: { value: CourseEntitlements; onChange: (v: CourseEntitlements) => void }) {
  const e = value || {};
  const set = (k: keyof CourseEntitlements, val: unknown) => onChange({ ...e, [k]: val });
  const [quizzes, setQuizzes] = useState<QuizLite[]>([]);
  const [caPdfs, setCaPdfs] = useState<CaPdfLite[]>([]);

  useEffect(() => {
    fetch("/api/admin/quizzes").then((r) => r.json()).then((d) => d.ok && setQuizzes(d.quizzes || [])).catch(() => {});
    fetch("/api/admin/current-affairs/pdfs").then((r) => r.json()).then((d) => d.ok && setCaPdfs(d.pdfs || [])).catch(() => {});
  }, []);

  function toggleId(key: "quiz_ids" | "ca_pdf_ids", id: string) {
    const cur = (e[key] as string[]) || [];
    set(key, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  const paidQuizzes = quizzes.filter((q) => q.requires_payment);
  const freeQuizzes = quizzes.filter((q) => !q.requires_payment);
  const accessType = e.access_type || "lifetime";

  const summary: string[] = [];
  if (e.class_hub !== false) summary.push("Class Hub / live classes");
  if (e.recorded) summary.push("Recorded lectures");
  if (e.quizzes_all_free) summary.push("All free quizzes");
  if ((e.quiz_ids || []).length) summary.push(`${e.quiz_ids!.length} test${e.quiz_ids!.length > 1 ? "s" : ""}/series`);
  if (e.ca_all_free) summary.push("All free Current Affairs");
  if ((e.ca_pdf_ids || []).length) summary.push(`${e.ca_pdf_ids!.length} CA compilation${e.ca_pdf_ids!.length > 1 ? "s" : ""}`);
  if ((e.library_doc_ids || []).length) summary.push(`${e.library_doc_ids!.length} study PDF${e.library_doc_ids!.length > 1 ? "s" : ""}`);

  return (
    <div className="sm:col-span-2 space-y-5">
      {/* What this course includes — scannable summary */}
      <div className="rounded-xl border border-line bg-surface2/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">This course unlocks</p>
        {summary.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.map((s) => <span key={s} className="pill pill-green">{s}</span>)}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted">Nothing extra yet — enrolled students get Class Hub only. Toggle items below.</p>
        )}
      </div>

      {/* Access type */}
      <div className="rounded-xl border border-line p-4">
        <p className="font-semibold text-ink">Access type</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="Validity">
            <select className="input" value={accessType} onChange={(ev) => set("access_type", ev.target.value)}>
              <option value="lifetime">Lifetime</option>
              <option value="limited">Limited (expires after N days)</option>
            </select>
          </Field>
          {accessType === "limited" && (
            <Field label="Days of access from enrolment" hint="e.g. 365 for one year.">
              <input type="number" className="input" value={e.access_days ?? ""} onChange={(ev) => set("access_days", ev.target.value ? Number(ev.target.value) : null)} placeholder="365" />
            </Field>
          )}
        </div>
      </div>

      {/* Classes */}
      <div className="rounded-xl border border-line p-4 space-y-2">
        <p className="font-semibold text-ink">Classes &amp; lectures</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={e.class_hub !== false} onChange={(ev) => set("class_hub", ev.target.checked)} /> Class Hub / live classes</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!e.recorded} onChange={(ev) => set("recorded", ev.target.checked)} /> Recorded lectures</label>
      </div>

      {/* Quizzes */}
      <div className="rounded-xl border border-line p-4 space-y-2">
        <p className="font-semibold text-ink">Quizzes &amp; test series</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!e.quizzes_all_free} onChange={(ev) => set("quizzes_all_free", ev.target.checked)} /> Unlock all free practice quizzes</label>
        {paidQuizzes.length > 0 && (
          <div className="mt-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Paid test series — select which this course unlocks</p>
            <div className="mt-1.5 max-h-44 space-y-1 overflow-auto rounded-lg border border-line p-2">
              {paidQuizzes.map((q) => (
                <label key={q.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={(e.quiz_ids || []).includes(q.id)} onChange={() => toggleId("quiz_ids", q.id)} /> {q.title}
                </label>
              ))}
            </div>
          </div>
        )}
        {freeQuizzes.length > 0 && !e.quizzes_all_free && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs font-semibold text-primary">Or pick specific free quizzes…</summary>
            <div className="mt-1.5 max-h-44 space-y-1 overflow-auto rounded-lg border border-line p-2">
              {freeQuizzes.map((q) => (
                <label key={q.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={(e.quiz_ids || []).includes(q.id)} onChange={() => toggleId("quiz_ids", q.id)} /> {q.title}
                </label>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Current Affairs */}
      <div className="rounded-xl border border-line p-4 space-y-2">
        <p className="font-semibold text-ink">Current Affairs compilations</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!e.ca_all_free} onChange={(ev) => set("ca_all_free", ev.target.checked)} /> Unlock all free Current Affairs compilations</label>
        {caPdfs.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs font-semibold text-primary">Pick specific compilations…</summary>
            <div className="mt-1.5 max-h-44 space-y-1 overflow-auto rounded-lg border border-line p-2">
              {caPdfs.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={(e.ca_pdf_ids || []).includes(p.id)} onChange={() => toggleId("ca_pdf_ids", p.id)} /> {p.title}
                </label>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Study material */}
      <div className="rounded-xl border border-line p-4">
        <p className="font-semibold text-ink">Study material / PDFs</p>
        <p className="mb-2 text-xs text-muted">From the shared library — unlocked for enrolled students.</p>
        <LibraryPicker value={e.library_doc_ids || []} onChange={(ids) => set("library_doc_ids", ids)} hint="Downloadable by enrolled students." />
      </div>
    </div>
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

function genBatchId(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** First/blank batch for a brand-new course, optionally seeded from course fields. */
function makeStarterBatch(seed?: Partial<Course>): CourseBatch {
  return {
    id: genBatchId(),
    label: null,
    mode: ((seed?.modes?.[0] as LearningMode) || "Online") as LearningMode,
    timing: seed?.batch_timings?.[0] ?? "",
    start_date: seed?.batch_start ?? null,
    end_date: null,
    price: seed?.price ?? 0,
    original_price: seed?.original_price ?? null,
    pay_in_full_price: seed?.pay_in_full_price ?? null,
    emi_config: (seed?.emi_config || {}) as CourseEmiConfig,
    capacity: seed?.capacity ?? null,
    seats_left: seed?.seats_left ?? null,
  };
}

/** Read the single mode/timing off a batch (tolerates legacy array shape). */
const oneMode = (b: CourseBatch): string => (Array.isArray(b.mode) ? b.mode[0] : b.mode) || "";
const oneTiming = (b: CourseBatch): string => (Array.isArray(b.timing) ? b.timing[0] : b.timing) || "";
const autoLabel = (m: string, t: string): string | null => [m, t].filter(Boolean).join(" · ") || null;

/** Read-only summary of the default batch's schedule (shown in Basic Details). */
function DerivedScheduleSummary({ batch }: { batch: CourseBatch | null }) {
  if (!batch) {
    return <p className="rounded-xl border border-dashed border-line bg-surface2/40 px-3 py-3 text-sm text-muted">No batch yet — add one in the <strong>Batches</strong> tab and it becomes the default.</p>;
  }
  return (
    <div className="rounded-xl border border-line bg-surface2/40 p-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Default batch (auto-derived on save)</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="pill">Mode: {batchModeLabel(batch) || "—"}</span>
        <span className="pill">Timing: {batchTimingLabel(batch) || "—"}</span>
        <span className="pill">Starts: {batch.start_date ? formatISTDate(batch.start_date) : "—"}</span>
      </div>
      <p className="mt-2 text-xs text-muted">Edit these in the <strong>Batches</strong> tab.</p>
    </div>
  );
}

/** Read-only summary of the default batch's pricing (shown in Pricing & Seats). */
function DerivedPricingSummary({ batch }: { batch: CourseBatch | null }) {
  if (!batch) {
    return <p className="rounded-xl border border-dashed border-line bg-surface2/40 px-3 py-3 text-sm text-muted">No batch yet — add one in the <strong>Batches</strong> tab to set the price.</p>;
  }
  const price = Math.max(0, Math.round(batch.price || 0));
  const pif = batch.pay_in_full_price && batch.pay_in_full_price > 0 ? Math.round(batch.pay_in_full_price) : null;
  const orig = batch.original_price && batch.original_price > price ? Math.round(batch.original_price) : null;
  const emi = resolveEmiConfig({ emi_config: batch.emi_config, price: batch.price });
  return (
    <div className="rounded-xl border border-line bg-surface2/40 p-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Default batch pricing (auto-derived on save)</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="pill">Price: {formatINR(price)}</span>
        {pif != null && pif < price && <span className="pill">Pay-in-full: {formatINR(pif)}</span>}
        {orig != null && <span className="pill">Original: {formatINR(orig)}</span>}
        <span className="pill">{emi.enabled ? `EMI: ${emi.installmentCounts.join("/")}×` : "EMI: off"}</span>
      </div>
      <p className="mt-2 text-xs text-muted">Edit pricing per batch in the <strong>Batches</strong> tab.</p>
    </div>
  );
}

/**
 * Batch editor — the single source of truth for schedule + pricing. ONE batch =
 * ONE mode + ONE timing + ONE start date + its own price/EMI/seats + a label.
 * What the admin builds here is exactly what the student picks in the enroll
 * selector. The default batch fills the course-level fields on save. Legacy
 * batches that still hold mode/timing arrays are read via oneMode/oneTiming and
 * are only normalised to single values when the admin actually edits them (so
 * existing data is never silently migrated).
 */
function BatchesEditor({
  course,
  value,
  defaultId,
  onChange,
}: {
  course: Partial<Course>;
  value: CourseBatch[];
  defaultId: string | null;
  onChange: (batches: CourseBatch[], defaultId: string | null) => void;
}) {
  const batches = value || [];
  const [qaModes, setQaModes] = useState<string[]>(["Online"]);
  const [qaTimings, setQaTimings] = useState<string[]>(["Morning", "Evening"]);

  const blank = (mode?: string, timing?: string): CourseBatch => ({
    id: genBatchId(),
    label: autoLabel(mode || "", timing || ""),
    mode: ((mode ?? (course.modes?.[0] as string) ?? "Online")) as LearningMode,
    timing: timing ?? (course.batch_timings?.[0] ?? ""),
    start_date: course.batch_start ?? null,
    end_date: null,
    price: course.price ?? 0,
    original_price: course.original_price ?? null,
    pay_in_full_price: course.pay_in_full_price ?? null,
    emi_config: (course.emi_config || {}) as CourseEmiConfig,
    capacity: course.capacity ?? null,
    seats_left: course.seats_left ?? null,
  });

  const update = (i: number, patch: Partial<CourseBatch>) =>
    onChange(batches.map((b, j) => (j === i ? { ...b, ...patch } : b)), defaultId);

  // Changing mode/timing also refreshes the label when it was still auto-generated
  // (never clobbers a label the admin typed manually).
  const changeMode = (i: number, m: string) => {
    const b = batches[i];
    const wasAuto = !b.label || b.label === autoLabel(oneMode(b), oneTiming(b));
    update(i, { mode: m as LearningMode, ...(wasAuto ? { label: autoLabel(m, oneTiming(b)) } : {}) });
  };
  const changeTiming = (i: number, t: string) => {
    const b = batches[i];
    const next = oneTiming(b) === t ? "" : t; // click active timing to clear
    const wasAuto = !b.label || b.label === autoLabel(oneMode(b), oneTiming(b));
    update(i, { timing: next, ...(wasAuto ? { label: autoLabel(oneMode(b), next) } : {}) });
  };

  const addNew = () => {
    const b = blank();
    onChange([...batches, b], defaultId ?? b.id);
  };

  const duplicate = (i: number) => {
    const src = batches[i];
    const copy: CourseBatch = { ...src, id: genBatchId(), label: src.label ? `${src.label} (copy)` : null };
    onChange([...batches.slice(0, i + 1), copy, ...batches.slice(i + 1)], defaultId);
  };

  const remove = (i: number) => {
    if (batches.length <= 1) return; // every course keeps at least one batch
    const removed = batches[i];
    const next = batches.filter((_, j) => j !== i);
    const nextDefault = removed.id === defaultId ? (next[0]?.id ?? null) : defaultId;
    onChange(next, nextDefault);
  };

  const toggleQa = (setter: React.Dispatch<React.SetStateAction<string[]>>, val: string) =>
    setter((cur) => (cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val]));

  const quickAdd = () => {
    const existing = new Set(batches.map((b) => `${oneMode(b)}|${oneTiming(b)}`));
    const toAdd: CourseBatch[] = [];
    for (const m of qaModes) {
      for (const t of qaTimings) {
        const key = `${m}|${t}`;
        if (existing.has(key)) continue;
        existing.add(key);
        toAdd.push(blank(m, t));
      }
    }
    if (!toAdd.length) return;
    const next = [...batches, ...toAdd];
    onChange(next, defaultId ?? next[0].id);
  };

  const qaCount = qaModes.length * qaTimings.length;

  const quickAddPanel = (
    <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-4">
      <p className="font-semibold text-ink">Quick add combinations</p>
      <p className="text-xs text-muted">Pick the modes and timings you offer — we generate one batch per combination (skipping any that already exist), prefilled and ready to price.</p>
      <div className="mt-3 space-y-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Modes</p>
          <div className="flex flex-wrap gap-2">
            {LEARNING_MODES.map((m) => (
              <button key={m} type="button" onClick={() => toggleQa(setQaModes, m)} className={`chip ${qaModes.includes(m) ? "chip-active" : ""}`}>{m}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Timings</p>
          <div className="flex flex-wrap gap-2">
            {BATCH_TIMINGS.map((t) => (
              <button key={t} type="button" onClick={() => toggleQa(setQaTimings, t)} className={`chip ${qaTimings.includes(t) ? "chip-active" : ""}`}>{t}</button>
            ))}
          </div>
        </div>
      </div>
      <button type="button" onClick={quickAdd} disabled={qaCount === 0} className="btn btn-secondary mt-3 text-sm disabled:opacity-50">
        + Generate {qaCount} batch{qaCount === 1 ? "" : "es"}
      </button>
    </div>
  );

  if (batches.length === 0) {
    return (
      <div className="sm:col-span-2 space-y-3">
        {quickAddPanel}
        <button type="button" onClick={addNew} className="btn btn-secondary text-sm">+ Add one batch</button>
      </div>
    );
  }

  return (
    <div className="sm:col-span-2 space-y-4">
      {quickAddPanel}

      {batches.map((b, i) => {
        const isDefault = b.id === defaultId;
        const pif = b.pay_in_full_price && b.pay_in_full_price > 0 ? Math.round(b.pay_in_full_price) : null;
        return (
          <div key={b.id} className={`rounded-2xl border p-4 ${isDefault ? "border-primary/50 bg-primary/5" : "border-line"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm font-medium">
                  <input type="radio" name="default-batch" checked={isDefault} onChange={() => onChange(batches, b.id)} />
                  Default
                </label>
                {isDefault && <span className="pill pill-green">Fills course-level fields</span>}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => duplicate(i)} className="text-xs font-semibold text-primary">Duplicate</button>
                <button type="button" onClick={() => remove(i)} disabled={batches.length <= 1} className="text-xs font-semibold text-danger disabled:opacity-40">Remove</button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Batch label" hint="Shown to students in the picker, e.g. “Online · Morning”. Auto-fills from mode + timing." full>
                <input className="input" value={b.label || ""} onChange={(e) => update(i, { label: e.target.value || null })} placeholder="e.g. Online · Morning" />
              </Field>

              <Field label="Mode" hint="One mode per batch.">
                <div className="flex flex-wrap gap-2">
                  {LEARNING_MODES.map((m) => (
                    <button key={m} type="button" onClick={() => changeMode(i, m)} className={`chip ${oneMode(b) === m ? "chip-active" : ""}`}>{m}</button>
                  ))}
                </div>
              </Field>

              <Field label="Timing" hint="One timing per batch. Click again to clear.">
                <div className="flex flex-wrap gap-2">
                  {BATCH_TIMINGS.map((t) => (
                    <button key={t} type="button" onClick={() => changeTiming(i, t)} className={`chip ${oneTiming(b) === t ? "chip-active" : ""}`}>{t}</button>
                  ))}
                </div>
              </Field>

              <Field label="Batch start date (IST)">
                <input type="date" className="input" value={b.start_date ? isoToISTInput(b.start_date).slice(0, 10) : ""} onChange={(e) => update(i, { start_date: e.target.value ? istInputToISO(`${e.target.value}T00:00`) : null })} />
              </Field>
              <Field label="Batch end date (IST)" hint="Optional.">
                <input type="date" className="input" value={b.end_date ? isoToISTInput(b.end_date).slice(0, 10) : ""} onChange={(e) => update(i, { end_date: e.target.value ? istInputToISO(`${e.target.value}T00:00`) : null })} />
              </Field>

              <Field label="Original price (₹)" hint="Strikethrough anchor. Optional.">
                <input type="number" className="input" value={b.original_price ?? ""} onChange={(e) => update(i, { original_price: e.target.value ? Number(e.target.value) : null })} />
              </Field>
              <Field label="Price — standard / total fee (₹)" hint="Base for this batch's EMI / Book-Your-Seat.">
                <input type="number" className="input" value={b.price ?? 0} onChange={(e) => update(i, { price: Number(e.target.value) })} />
              </Field>
              <Field label="Pay-in-Full price (₹)" hint="One-shot discount for this batch. Blank = charge standard price." full>
                <input type="number" className="input" value={b.pay_in_full_price ?? ""} onChange={(e) => update(i, { pay_in_full_price: e.target.value ? Number(e.target.value) : null })} placeholder="e.g. 40000" />
              </Field>

              <Field label="Total seats (capacity)" hint="Optional.">
                <input type="number" className="input" value={b.capacity ?? ""} onChange={(e) => update(i, { capacity: e.target.value ? Number(e.target.value) : null })} />
              </Field>
              <Field label="Seats remaining" hint="Optional.">
                <input type="number" className="input" value={b.seats_left ?? ""} onChange={(e) => update(i, { seats_left: e.target.value ? Number(e.target.value) : null })} />
              </Field>
            </div>

            <div className="mt-2 text-xs text-muted">
              {formatINR(Math.max(0, Math.round(b.price || 0)))}
              {pif != null && pif < Math.round(b.price || 0) ? ` · pay-in-full ${formatINR(pif)}` : ""}
              {b.start_date ? ` · starts ${formatISTDate(b.start_date)}` : ""}
            </div>

            <div className="mt-3 rounded-xl border border-line p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Book Your Seat + EMI (this batch)</p>
              <EmiConfigEditor total={b.price ?? 0} value={b.emi_config || {}} onChange={(v) => update(i, { emi_config: v })} />
            </div>
          </div>
        );
      })}

      <button type="button" onClick={addNew} className="btn btn-secondary text-sm">+ Add one batch</button>
    </div>
  );
}

/** Shows admins exactly how the three prices relate, so the model is crystal-clear. */
function PricingPreview({ original, price, payInFull }: { original: number | null; price: number; payInFull: number | null }) {
  const std = Math.max(0, Math.round(price || 0));
  const pif = payInFull && payInFull > 0 ? Math.round(payInFull) : null;
  const fullSaving = pif != null ? std - pif : 0;
  return (
    <div className="sm:col-span-2 rounded-xl border border-line bg-surface2/40 p-4 text-sm">
      <p className="mb-2 font-semibold text-ink">How students see it</p>
      <ul className="space-y-1.5">
        {original != null && original > std && (
          <li className="flex items-center justify-between">
            <span className="text-muted">Original price (anchor)</span>
            <span className="text-muted line-through">{formatINR(original)}</span>
          </li>
        )}
        <li className="flex items-center justify-between">
          <span className="text-ink2">Standard / total fee — base for EMI &amp; Book-Your-Seat</span>
          <span className="font-bold text-ink">{formatINR(std)}</span>
        </li>
        <li className="flex items-center justify-between">
          <span className="text-ink2">Pay-in-Full price — one-shot</span>
          <span className="font-bold text-success">{pif != null ? formatINR(pif) : `${formatINR(std)} (no extra discount)`}</span>
        </li>
      </ul>
      {pif != null && fullSaving > 0 && (
        <p className="mt-2 rounded-lg bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
          Paying in full saves {formatINR(fullSaving)} vs the EMI base.
        </p>
      )}
      {pif != null && fullSaving <= 0 && (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700">
          Pay-in-Full price should be lower than the standard Price to act as a discount.
        </p>
      )}
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
