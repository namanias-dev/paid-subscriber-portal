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
import type {
  Webinar,
  FAQItem,
  ContactLink,
  PdfResource,
  Coupon,
  SeatConfig,
  WhatsAppConfig,
  VideoConfig,
  MentorInfo,
  SeoConfig,
  Review,
  LearnItem,
  PageSection,
  CrossSell,
} from "@/lib/types";

const BACK = "/admin/webinars";

/** ISO -> value for <input type="datetime-local"> (local time, no seconds). */
function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function WebinarForm({ webinar }: { webinar?: Webinar }) {
  const router = useRouter();
  const { toast } = useToast();
  const isNew = !webinar?.id;

  const [title, setTitle] = useState(webinar?.title || "");
  const [slug, setSlug] = useState(webinar?.slug || "");
  const [description, setDescription] = useState(webinar?.description || "");
  const [datetime, setDatetime] = useState(toLocalInput(webinar?.datetime));
  const [price, setPrice] = useState<number>(webinar?.price ?? 0);
  const [capacity, setCapacity] = useState<number | "">(webinar?.capacity ?? "");
  const [link, setLink] = useState(webinar?.link || "");
  const [recordingLink, setRecordingLink] = useState(webinar?.recording_link || "");
  const [status, setStatus] = useState<Webinar["status"]>(webinar?.status || "upcoming");
  const [endDatetime, setEndDatetime] = useState(toLocalInput(webinar?.end_datetime));
  const [longDescription, setLongDescription] = useState(webinar?.long_description || "");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(webinar?.cover_image_url || null);
  const [mobileImageUrl, setMobileImageUrl] = useState<string | null>(webinar?.mobile_image_url || null);
  const [faqs, setFaqs] = useState<FAQItem[]>(webinar?.faqs || []);
  const [contactLinks, setContactLinks] = useState<ContactLink[]>(webinar?.contact_links || []);
  const [pdfResources, setPdfResources] = useState<PdfResource[]>(webinar?.pdf_resources || []);
  const [coupons, setCoupons] = useState<Coupon[]>(webinar?.coupons || []);
  const [active, setActive] = useState<boolean>(webinar?.active !== false);
  // Premium landing fields
  const [badgeLabel, setBadgeLabel] = useState(webinar?.badge_label || "");
  const [aboutHtml, setAboutHtml] = useState<string>(webinar?.about_html || "");
  const [seatConfig, setSeatConfig] = useState<SeatConfig>(webinar?.seat_config || {});
  const [whatsappConfig, setWhatsappConfig] = useState<WhatsAppConfig>(webinar?.whatsapp_config || {});
  const [videoConfig, setVideoConfig] = useState<VideoConfig>(webinar?.video_config || {});
  const [mentor, setMentor] = useState<MentorInfo>(webinar?.mentor || {});
  const [seo, setSeo] = useState<SeoConfig>(webinar?.seo || {});
  const [whatYouLearn, setWhatYouLearn] = useState<LearnItem[]>(webinar?.what_you_learn || []);
  const [whoShouldAttend, setWhoShouldAttend] = useState<string[]>(webinar?.who_should_attend || []);
  const [whatYouGet, setWhatYouGet] = useState<LearnItem[]>(webinar?.what_you_get || []);
  const [reviews, setReviews] = useState<Review[]>(webinar?.reviews || []);
  const [sections, setSections] = useState<PageSection[]>(webinar?.sections || []);
  // Portal experience fields
  const [sessionType, setSessionType] = useState<"live" | "recorded">(webinar?.session_type === "recorded" ? "recorded" : "live");
  const [joinNote, setJoinNote] = useState(webinar?.join_note || "");
  const [materials, setMaterials] = useState<PdfResource[]>(webinar?.materials || []);
  const [crossSell, setCrossSell] = useState<CrossSell>(webinar?.cross_sell || {});
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return toast("Title is required", "error");
    if (datetime && endDatetime && new Date(endDatetime) <= new Date(datetime)) {
      return toast("End time must be after the start time.", "error");
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      slug: slug.trim() || undefined,
      description,
      long_description: longDescription || null,
      datetime: datetime ? new Date(datetime).toISOString() : new Date().toISOString(),
      end_datetime: endDatetime ? new Date(endDatetime).toISOString() : null,
      price: Number(price) || 0,
      capacity: capacity === "" ? null : Number(capacity),
      link: link.trim() || null,
      recording_link: recordingLink.trim() || null,
      status,
      cover_image_url: coverImageUrl,
      mobile_image_url: mobileImageUrl,
      faqs: faqs.filter((f) => f.q.trim()),
      contact_links: contactLinks.filter((c) => c.value.trim()),
      pdf_resources: pdfResources.filter((p) => p.url.trim()),
      coupons: coupons.filter((c) => c.code.trim()),
      active,
      badge_label: badgeLabel.trim() || null,
      about_html: aboutHtml || null,
      seat_config: seatConfig,
      whatsapp_config: whatsappConfig,
      video_config: videoConfig,
      mentor,
      seo,
      what_you_learn: whatYouLearn.filter((i) => i.title.trim()),
      who_should_attend: whoShouldAttend.filter((s) => s.trim()),
      what_you_get: whatYouGet.filter((i) => i.title.trim()),
      reviews: reviews.filter((r) => r.name.trim() && r.text.trim()),
      sections: sections.filter((s) => s.title.trim()),
      session_type: sessionType,
      join_note: joinNote.trim() || null,
      materials: materials.filter((m) => m.url.trim()),
      cross_sell: crossSell,
    };
    const res = await fetch(isNew ? "/api/admin/webinars" : `/api/admin/webinars/${webinar!.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (data.ok) {
      toast(isNew ? "Webinar created — public page generated" : "Webinar updated", "success");
      router.push(BACK);
      router.refresh();
    } else {
      toast(data.error || "Failed to save", "error");
    }
  }

  return (
    <FormShell
      title={isNew ? "Create New Webinar" : "Edit Webinar"}
      subtitle="Auto-generates a public registration page at /webinars/<slug>"
      backHref={BACK}
    >
      <Tabs
        items={[
          {
            id: "basic",
            label: "Basic Details",
            content: (
              <>
                <Section title="Basics" desc="Name and how it shows up publicly.">
                  <Field label="Title" full>
                    <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. UPSC 2027 Strategy Masterclass" />
                  </Field>
                  <Field label="Slug (URL)" hint="Leave blank to auto-generate from the title.">
                    <input className="input" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} placeholder="upsc-2027-strategy" />
                  </Field>
                  <Field label="Status">
                    <select className="input" value={status} onChange={(e) => setStatus(e.target.value as Webinar["status"])}>
                      <option value="upcoming">Upcoming</option>
                      <option value="completed">Completed (show recording)</option>
                    </select>
                  </Field>
                  <Field label="Hero badge label (optional)" hint='e.g. "Live Webinar" or "Free Masterclass".'>
                    <input className="input" value={badgeLabel} onChange={(e) => setBadgeLabel(e.target.value)} placeholder="Live Webinar" />
                  </Field>
                  <Field label="Short description" full hint="Shown on cards and as a fallback meta description.">
                    <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
                  </Field>
                  <ActiveToggle active={active} onChange={setActive} />
                </Section>

                <Section title="Schedule" desc="Dates reflect on the public page immediately after saving.">
                  <Field label="Start date & time">
                    <input type="datetime-local" className="input" value={datetime} onChange={(e) => setDatetime(e.target.value)} />
                  </Field>
                  <Field label="End date & time (optional)" hint="Leave blank for a single-time session.">
                    <input type="datetime-local" className="input" value={endDatetime} onChange={(e) => setEndDatetime(e.target.value)} />
                  </Field>
                </Section>

                <Section title="Session type & links" desc="Drives the smart access button on the student's portal card.">
                  <Field label="Session type" hint="Live = Zoom join before start, recording after. Recorded = recording only.">
                    <select className="input" value={sessionType} onChange={(e) => setSessionType(e.target.value as "live" | "recorded")}>
                      <option value="live">Live webinar</option>
                      <option value="recorded">Recorded session</option>
                    </select>
                  </Field>
                  <Field label="Zoom / live class link" hint='Shown as "Attend Live Class" until the start time passes (live sessions).'>
                    <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://zoom.us/j/…" />
                  </Field>
                  <Field label="Recording link (YouTube / Google Drive)" full hint="Used automatically once the webinar date has passed (or immediately for recorded sessions).">
                    <input className="input" value={recordingLink} onChange={(e) => setRecordingLink(e.target.value)} placeholder="https://youtu.be/… or https://drive.google.com/file/d/…/view" />
                  </Field>
                  <Field label="Join note (optional)" full hint='Appears inside the "How to join" steps on the student card. Leave blank to show the default Zoom flow.'>
                    <input className="input" value={joinNote} onChange={(e) => setJoinNote(e.target.value)} placeholder="e.g. Zoom passcode: 1234" />
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
                  <Field label="Price (₹)" hint="0 = free registration.">
                    <input type="number" min={0} className="input" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
                  </Field>
                  <Field label="Capacity (seats)" hint="Optional — leave blank for unlimited.">
                    <input type="number" min={0} className="input" value={capacity} onChange={(e) => setCapacity(e.target.value === "" ? "" : Number(e.target.value))} />
                  </Field>
                </Section>
                <Section title="Seats remaining" desc="Admin-controlled. When off, no seats line appears on the public page.">
                  <SeatCounterEditor value={seatConfig} onChange={setSeatConfig} />
                </Section>
                <Section title="Coupons" desc="Discount codes attendees can apply at checkout.">
                  <CouponsEditor value={coupons} onChange={setCoupons} />
                </Section>
              </>
            ),
          },
          {
            id: "media",
            label: "Media",
            content: (
              <>
                <Section title="Cover image" desc="Used on the registration page and social share cards (Open Graph).">
                  <ImageUploadField label="Primary cover image" folder="covers" value={coverImageUrl} onChange={setCoverImageUrl} hint="Recommended 1200×630 (16:9 / wide)." />
                  <ImageUploadField label="Mobile image (optional)" folder="covers/mobile" value={mobileImageUrl} onChange={setMobileImageUrl} hint="Optional portrait/square crop. Falls back to the primary image." />
                </Section>
                <Section title="Video" desc="Embed a YouTube video or link an Instagram reel.">
                  <VideoSectionEditor value={videoConfig} onChange={setVideoConfig} />
                </Section>
                <Section title="Downloadable resources" desc="Bonus PDFs attached to this webinar.">
                  <PdfResourcesEditor value={pdfResources} onChange={setPdfResources} folder="resources" />
                </Section>
              </>
            ),
          },
          {
            id: "content",
            label: "Rich Content",
            content: (
              <>
                <Section title="About this session" desc="Rich formatting — headings, lists, images, links, tables.">
                  <Field label="About (rich text)" full>
                    <RichTextEditor value={aboutHtml} onChange={setAboutHtml} placeholder="Describe the session in detail…" />
                  </Field>
                  <Field label="Plain fallback description (optional)" full hint="Used only if the rich About above is empty.">
                    <textarea className="input" rows={4} value={longDescription} onChange={(e) => setLongDescription(e.target.value)} />
                  </Field>
                </Section>
                <Section title="What you'll learn" desc="Icon cards highlighting key takeaways.">
                  <LearnItemsEditor value={whatYouLearn} onChange={setWhatYouLearn} addLabel="+ Add learning point" />
                </Section>
                <Section title="Who should attend">
                  <StringListEditor value={whoShouldAttend} onChange={setWhoShouldAttend} placeholder="e.g. UPSC 2027 first-time aspirants" addLabel="+ Add audience point" />
                </Section>
                <Section title="What you'll get" desc="Deliverables / bonuses included.">
                  <LearnItemsEditor value={whatYouGet} onChange={setWhatYouGet} addLabel="+ Add deliverable" />
                </Section>
                <Section title="Mentor">
                  <MentorEditor value={mentor} onChange={setMentor} folder="mentors" />
                </Section>
                <Section title="FAQs">
                  <FaqEditor value={faqs} onChange={setFaqs} />
                </Section>
                <Section title="Custom sections" desc="Optional flexible blocks rendered after the main content.">
                  <PageSectionsEditor value={sections} onChange={setSections} folder="sections" />
                </Section>
              </>
            ),
          },
          {
            id: "reviews",
            label: "Reviews",
            content: (
              <Section title="Reviews & testimonials" desc="Build trust with student results and ratings.">
                <ReviewsEditor value={reviews} onChange={setReviews} folder="reviews" />
              </Section>
            ),
          },
          {
            id: "materials",
            label: "After Registration",
            content: (
              <Section
                title="Materials & deliverables"
                desc="Shown ONLY to students who have registered/paid (entitlement-gated) — on their portal card. Upload PDFs or paste a Google Drive link, each with a title."
              >
                <PdfResourcesEditor value={materials} onChange={setMaterials} folder="materials" />
              </Section>
            ),
          },
          {
            id: "crosssell",
            label: "Cross-sell",
            content: (
              <Section title="Promote a course" desc="A tasteful upsell block on the student's webinar card (e.g. “Join Safalta Batch”).">
                <label className="flex items-center gap-3 sm:col-span-2">
                  <input type="checkbox" checked={!!crossSell.enabled} onChange={(e) => setCrossSell({ ...crossSell, enabled: e.target.checked })} />
                  <span className="text-sm"><b>{crossSell.enabled ? "Enabled" : "Disabled"}</b> — show this promo on the student card.</span>
                </label>
                <Field label="Promo title">
                  <input className="input" value={crossSell.title || ""} onChange={(e) => setCrossSell({ ...crossSell, title: e.target.value })} placeholder="Join the Safalta Batch" />
                </Field>
                <Field label="CTA button label">
                  <input className="input" value={crossSell.cta_label || ""} onChange={(e) => setCrossSell({ ...crossSell, cta_label: e.target.value })} placeholder="Explore the batch →" />
                </Field>
                <Field label="Description" full>
                  <textarea className="input" rows={2} value={crossSell.description || ""} onChange={(e) => setCrossSell({ ...crossSell, description: e.target.value })} placeholder="Limited-time offer for webinar attendees…" />
                </Field>
                <Field label="Course link">
                  <input className="input" value={crossSell.href || ""} onChange={(e) => setCrossSell({ ...crossSell, href: e.target.value })} placeholder="/courses/safalta-batch" />
                </Field>
                <Field label="Promo / discount code (optional)">
                  <input className="input uppercase" value={crossSell.promo_code || ""} onChange={(e) => setCrossSell({ ...crossSell, promo_code: e.target.value.toUpperCase() })} placeholder="WEBINAR20" />
                </Field>
                <Field label="Show timing" full hint="Control when the promo appears for best conversion.">
                  <select className="input" value={crossSell.show_timing || "always"} onChange={(e) => setCrossSell({ ...crossSell, show_timing: e.target.value as "always" | "after_webinar" })}>
                    <option value="always">Always</option>
                    <option value="after_webinar">Only on/after the webinar date</option>
                  </select>
                </Field>
              </Section>
            ),
          },
          {
            id: "seo",
            label: "SEO",
            content: (
              <Section title="Search & social" desc="Controls Google title, description and share previews.">
                <SeoEditor value={seo} onChange={setSeo} folder="seo" />
              </Section>
            ),
          },
          {
            id: "contact",
            label: "Contact / WhatsApp",
            content: (
              <>
                <Section title="WhatsApp & contact" desc="Numbers are auto-normalized to +91 — fixes broken wa.me links.">
                  <WhatsAppEditor value={whatsappConfig} onChange={setWhatsappConfig} />
                </Section>
                <Section title="Additional contact links" desc="Extra WhatsApp / phone / email / telegram buttons.">
                  <ContactLinksEditor value={contactLinks} onChange={setContactLinks} />
                </Section>
              </>
            ),
          },
        ]}
      />

      <FormActions saving={saving} onSave={save} cancelHref={BACK} saveLabel={isNew ? "Create Webinar" : "Save Changes"} />
    </FormShell>
  );
}
