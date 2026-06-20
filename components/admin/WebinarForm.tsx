"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormShell, Section, Field, FormActions } from "./FormKit";
import { ImageUploadField, FaqEditor, ContactLinksEditor, PdfResourcesEditor, CouponsEditor, ActiveToggle } from "./FormFields";
import { useToast } from "@/components/ui/Toast";
import type { Webinar, FAQItem, ContactLink, PdfResource, Coupon } from "@/lib/types";

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
        <Field label="Short description" full hint="Shown on cards and as the meta description.">
          <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Full description" full hint="Multi-paragraph details shown on the registration page.">
          <textarea className="input" rows={6} value={longDescription} onChange={(e) => setLongDescription(e.target.value)} />
        </Field>
        <ActiveToggle active={active} onChange={setActive} />
      </Section>

      <Section title="Cover image" desc="Used on the registration page and social share cards (Open Graph).">
        <ImageUploadField label="Primary cover image" folder="covers" value={coverImageUrl} onChange={setCoverImageUrl} hint="Recommended 1200×630 (16:9 / wide)." />
        <ImageUploadField label="Mobile image (optional)" folder="covers/mobile" value={mobileImageUrl} onChange={setMobileImageUrl} hint="Optional portrait/square crop. Falls back to the primary image." />
      </Section>

      <Section title="Schedule & pricing" desc="Dates reflect on the public page immediately after saving.">
        <Field label="Start date & time">
          <input type="datetime-local" className="input" value={datetime} onChange={(e) => setDatetime(e.target.value)} />
        </Field>
        <Field label="End date & time (optional)" hint="Leave blank for a single-time session.">
          <input type="datetime-local" className="input" value={endDatetime} onChange={(e) => setEndDatetime(e.target.value)} />
        </Field>
        <Field label="Price (₹)" hint="0 = free registration.">
          <input type="number" min={0} className="input" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </Field>
        <Field label="Capacity (seats)" hint="Optional — leave blank for unlimited.">
          <input type="number" min={0} className="input" value={capacity} onChange={(e) => setCapacity(e.target.value === "" ? "" : Number(e.target.value))} />
        </Field>
      </Section>

      <Section title="Links">
        <Field label="Join link (Zoom / YouTube)">
          <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Recording link" hint="Shown for completed webinars.">
          <input className="input" value={recordingLink} onChange={(e) => setRecordingLink(e.target.value)} placeholder="https://…" />
        </Field>
      </Section>

      <Section title="Contact links" desc="WhatsApp / phone / email buttons shown on the registration page.">
        <ContactLinksEditor value={contactLinks} onChange={setContactLinks} />
      </Section>

      <Section title="Downloadable resources" desc="Bonus PDFs attached to this webinar.">
        <PdfResourcesEditor value={pdfResources} onChange={setPdfResources} folder="resources" />
      </Section>

      <Section title="FAQs">
        <FaqEditor value={faqs} onChange={setFaqs} />
      </Section>

      <Section title="Coupons" desc="Discount codes attendees can apply at checkout.">
        <CouponsEditor value={coupons} onChange={setCoupons} />
      </Section>

      <FormActions saving={saving} onSave={save} cancelHref={BACK} saveLabel={isNew ? "Create Webinar" : "Save Changes"} />
    </FormShell>
  );
}
