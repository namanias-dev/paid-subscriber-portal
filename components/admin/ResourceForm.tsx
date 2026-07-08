"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FormShell, Section, Field, FormActions, Tabs } from "./FormKit";
import { ImageUploadField, StringListEditor, PageSectionsEditor, FaqEditor } from "./FormFields";
import RichTextEditor from "./RichTextEditor";
import { useToast } from "@/components/ui/Toast";
import { SITE_URL } from "@/lib/config";
import {
  RESOURCE_CATEGORIES,
  RESOURCE_EXAM_RELEVANCE,
  RESOURCE_DIFFICULTY,
  RESOURCE_TARGET_YEARS,
  JOURNEY_STAGES,
  CTA_PRESETS,
  ctaPreset,
} from "@/lib/resourceConstants";
import type {
  Resource,
  ResourceStatus,
  ResourceExamRelevance,
  ResourceDifficulty,
  ResourceCta,
  ResourceRelated,
  CaSeo,
  FAQItem,
  PageSection,
} from "@/lib/types";

const BACK = "/admin/resources";

function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface MetaRes { slug: string; title: string; category: string | null; subject: string | null; tags: string[]; focus_keyword: string | null; status: string }
interface MetaPicker {
  resources: MetaRes[];
  quizzes: { slug: string; title: string }[];
  webinars: { slug: string; title: string }[];
  courses: { slug: string; title: string }[];
  pdfs: { id: string; title: string; kind: string }[];
}

export default function ResourceForm({ resource }: { resource?: Resource }) {
  const router = useRouter();
  const { toast } = useToast();
  const isNew = !resource?.id;

  const [title, setTitle] = useState(resource?.title || "");
  const [slug, setSlug] = useState(resource?.slug || "");
  const [summary, setSummary] = useState(resource?.summary || "");
  const [category, setCategory] = useState(resource?.category || "");
  const [subject, setSubject] = useState(resource?.subject || "");
  const [examRelevance, setExamRelevance] = useState<ResourceExamRelevance | "">(resource?.exam_relevance || "");
  const [targetYear, setTargetYear] = useState(resource?.target_year || "evergreen");
  const [difficulty, setDifficulty] = useState<ResourceDifficulty | "">(resource?.difficulty || "");
  const [author, setAuthor] = useState(resource?.author || "Naman Sir");
  const [readingTime, setReadingTime] = useState<number | "">(resource?.reading_time ?? "");
  const [featuredImage, setFeaturedImage] = useState<string | null>(resource?.featured_image || null);

  const [bodyHtml, setBodyHtml] = useState(resource?.body_html || "");
  const [sections, setSections] = useState<PageSection[]>(resource?.sections || []);
  const [tags, setTags] = useState<string[]>(resource?.tags || []);
  const [pdfIds, setPdfIds] = useState<string[]>(resource?.pdf_ids || []);
  const [faq, setFaq] = useState<FAQItem[]>(resource?.faq || []);

  const [ctaBlocks, setCtaBlocks] = useState<ResourceCta[]>(resource?.cta_blocks || []);
  const [related, setRelated] = useState<ResourceRelated>(resource?.related || {});
  const [focusKeyword, setFocusKeyword] = useState(resource?.focus_keyword || "");
  const [seo, setSeo] = useState<CaSeo>(resource?.seo || { structured_data_enabled: true });

  const [journeyStage, setJourneyStage] = useState(resource?.journey_stage || "");
  const [orderIndex, setOrderIndex] = useState<number | "">(resource?.order_index ?? "");
  const [isLocal, setIsLocal] = useState(!!resource?.is_local);

  const [status, setStatus] = useState<ResourceStatus>(resource?.status || "draft");
  const [publishAt, setPublishAt] = useState(toLocalInput(resource?.publish_at));

  const [meta, setMeta] = useState<MetaPicker>({ resources: [], quizzes: [], webinars: [], courses: [], pdfs: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/resources/meta")
      .then((r) => r.json())
      .then((d) => d.meta && setMeta(d.meta))
      .catch(() => {});
  }, []);

  // --- Internal-link suggestions (white-hat auto internal linking) ---
  const suggestions = useMemo(() => {
    const tagSet = new Set(tags);
    const focus = focusKeyword.toLowerCase();
    const already = new Set(related.resource_slugs || []);
    return meta.resources
      .filter((r) => r.slug !== slug && r.status === "published" && !already.has(r.slug))
      .map((r) => {
        const reasons: string[] = [];
        let score = 0;
        if (r.category && r.category === category) { score += 3; reasons.push("same category"); }
        if (r.subject && r.subject === subject) { score += 2; reasons.push("same subject"); }
        const shared = (r.tags || []).filter((t) => tagSet.has(t));
        if (shared.length) { score += shared.length * 2; reasons.push(`tags: ${shared.join(", ")}`); }
        if (focus && r.title.toLowerCase().includes(focus)) { score += 2; reasons.push("keyword in title"); }
        return { slug: r.slug, title: r.title, reason: reasons.join(" · "), score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [meta.resources, tags, focusKeyword, category, subject, slug, related.resource_slugs]);

  // --- SEO helpers ---
  const previewTitle = (seo.title?.trim() || `${title} | Naman IAS`).slice(0, 65);
  const previewDesc = (seo.description?.trim() || summary).slice(0, 160);
  const previewUrl = `${SITE_URL}/resources/${slug || "your-article-slug"}`;
  const plainBody = bodyHtml.replace(/<[^>]+>/g, " ").toLowerCase();
  const focusChecks = focusKeyword.trim()
    ? [
        { label: "In SEO title", ok: previewTitle.toLowerCase().includes(focusKeyword.toLowerCase()) },
        { label: "In meta description", ok: previewDesc.toLowerCase().includes(focusKeyword.toLowerCase()) },
        { label: "In URL slug", ok: slug.includes(focusKeyword.toLowerCase().replace(/\s+/g, "-")) },
        { label: "In article body", ok: plainBody.includes(focusKeyword.toLowerCase()) },
        { label: "In an H2/H3 heading", ok: new RegExp(`<h[23][^>]*>[^<]*${focusKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(bodyHtml) },
      ]
    : [];
  const estReadTime = Math.max(1, Math.round(plainBody.split(/\s+/).filter(Boolean).length / 200));

  function toggle(list: string[] | undefined, v: string): string[] {
    const cur = list || [];
    return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  }
  function togglePdf(id: string) {
    setPdfIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function addCtaPreset(kind: ResourceCta["kind"]) {
    const p = ctaPreset(kind);
    setCtaBlocks((cur) => [...cur, { kind, title: p?.title || "", description: p?.description || "", cta_label: p?.cta_label || "", href: p?.href || "", enabled: true }]);
  }
  function updateCta(i: number, patch: Partial<ResourceCta>) {
    setCtaBlocks((cur) => cur.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function removeCta(i: number) {
    setCtaBlocks((cur) => cur.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!title.trim()) return toast("Title is required", "error");
    if (status === "published") {
      if (!summary.trim()) return toast("Summary is required to publish.", "error");
      if (!category) return toast("Pick a category before publishing.", "error");
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      slug: slug.trim() || undefined,
      summary: summary.trim(),
      body_html: bodyHtml || null,
      sections: sections.filter((s) => s.title?.trim()),
      category: category || null,
      subject: subject.trim() || null,
      exam_relevance: examRelevance || null,
      target_year: targetYear || null,
      difficulty: difficulty || null,
      status,
      publish_at:
        status === "published" && !publishAt
          ? new Date().toISOString()
          : publishAt
          ? new Date(publishAt).toISOString()
          : null,
      author: author.trim() || null,
      reading_time: readingTime === "" ? null : Number(readingTime),
      featured_image: featuredImage,
      tags,
      pdf_ids: pdfIds,
      faq,
      cta_blocks: ctaBlocks,
      related,
      focus_keyword: focusKeyword.trim() || null,
      seo,
      journey_stage: journeyStage || null,
      order_index: orderIndex === "" ? 0 : Number(orderIndex),
      is_local: isLocal,
    };
    const res = await fetch(isNew ? "/api/admin/resources" : `/api/admin/resources/${resource!.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (data.ok) {
      toast(isNew ? "Resource created" : "Resource updated", "success");
      router.push(BACK);
      router.refresh();
    } else {
      toast(data.error || "Failed to save", "error");
    }
  }

  return (
    <FormShell
      title={isNew ? "Create Resource" : "Edit Resource"}
      subtitle="Public page is generated at /resources/<slug>"
      backHref={BACK}
    >
      <Tabs
        items={[
          {
            id: "basic",
            label: "Basic",
            content: (
              <>
                <Section title="Basics" desc="Core fields shown across the site and in search.">
                  <Field label="Title" full>
                    <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Complete UPSC Beginner's Guide" />
                  </Field>
                  <Field label="Slug (URL)" hint="Leave blank to auto-generate. Category slugs are reserved.">
                    <input className="input" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} placeholder="upsc-beginners-guide" />
                  </Field>
                  <Field label="Category">
                    <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                      <option value="">— Select —</option>
                      {RESOURCE_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Short excerpt / summary" full hint="1–2 lines; also the meta-description fallback.">
                    <textarea className="input" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
                  </Field>
                  <Field label="Subject (optional)">
                    <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Polity" />
                  </Field>
                  <Field label="Exam relevance">
                    <select className="input" value={examRelevance} onChange={(e) => setExamRelevance((e.target.value || "") as ResourceExamRelevance | "")}>
                      <option value="">—</option>
                      {RESOURCE_EXAM_RELEVANCE.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Target year">
                    <select className="input" value={targetYear} onChange={(e) => setTargetYear(e.target.value)}>
                      {RESOURCE_TARGET_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </Field>
                  <Field label="Difficulty">
                    <select className="input" value={difficulty} onChange={(e) => setDifficulty((e.target.value || "") as ResourceDifficulty | "")}>
                      <option value="">—</option>
                      {RESOURCE_DIFFICULTY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Author / faculty">
                    <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Naman Sir" />
                  </Field>
                  <Field label="Reading time (min)" hint="Leave blank to auto-calculate.">
                    <input type="number" min={0} className="input" value={readingTime} onChange={(e) => setReadingTime(e.target.value === "" ? "" : Number(e.target.value))} />
                  </Field>
                </Section>
                <Section title="Tags" desc="Used for related articles and the internal-link graph.">
                  <StringListEditor value={tags} onChange={setTags} placeholder="e.g. ncert" addLabel="+ Add tag" />
                </Section>
                <Section title="Featured image" desc="Used in cards, hero and social shares (1200×630).">
                  <ImageUploadField label="Featured image" folder="resources" value={featuredImage} onChange={setFeaturedImage} hint="Recommended 1200×630." />
                </Section>
              </>
            ),
          },
          {
            id: "content",
            label: "Content",
            content: (
              <>
                <Section title="Article body" desc="Rich text — H2/H3, lists, tables, quotes, images, links, embeds.">
                  <Field label="Body" full>
                    <RichTextEditor value={bodyHtml} onChange={setBodyHtml} placeholder="Write the guide…" />
                  </Field>
                </Section>
                <Section title="Flexible sections" desc="Optional ordered blocks rendered after the body (with visibility toggle).">
                  <PageSectionsEditor value={sections} onChange={setSections} folder="resources/sections" />
                </Section>
                <Section title="FAQ" desc="Shown as an on-page FAQ and emitted as FAQPage schema (great for SEO).">
                  <FaqEditor value={faq} onChange={setFaq} />
                </Section>
                <Section title="Downloadable PDFs" desc="Attach backlink-earning assets (syllabus, roadmap, booklist).">
                  {meta.pdfs.length === 0 ? (
                    <p className="text-sm text-ink2 sm:col-span-2">No PDFs yet. Upload them in the CA PDF Library or Brochure Library.</p>
                  ) : (
                    <div className="sm:col-span-2 max-h-64 space-y-2 overflow-auto">
                      {meta.pdfs.map((p) => (
                        <label key={p.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                          <input type="checkbox" checked={pdfIds.includes(p.id)} onChange={() => togglePdf(p.id)} />
                          <span className="text-sm">{p.title}</span>
                          <span className="pill pill-gray ml-auto text-xs">{p.kind}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </Section>
              </>
            ),
          },
          {
            id: "seo",
            label: "SEO",
            content: (
              <>
                <Section title="Focus keyword" desc="The main query this article should rank for.">
                  <Field label="Focus keyword" full>
                    <input className="input" value={focusKeyword} onChange={(e) => setFocusKeyword(e.target.value)} placeholder="e.g. upsc preparation for beginners" />
                  </Field>
                  {focusKeyword.trim() && (
                    <div className="sm:col-span-2 space-y-1.5 rounded-xl border border-line bg-[var(--surface-2,#f8fafc)] p-3 text-sm">
                      {focusChecks.map((c) => (
                        <div key={c.label} className="flex items-center gap-2">
                          <span>{c.ok ? "✅" : "⚠️"}</span>
                          <span className={c.ok ? "" : "text-ink2"}>{c.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="sm:col-span-2 text-sm text-ink2">Estimated read time from body: <b>{estReadTime} min</b></div>
                </Section>

                <Section title="Search preview" desc="How this may appear on Google.">
                  <div className="sm:col-span-2 rounded-xl border border-line p-4">
                    <div className="text-[13px] text-[#4d5156]">{previewUrl}</div>
                    <div className="truncate text-[18px] leading-snug text-[#1a0dab]">{previewTitle || "Your SEO title"}</div>
                    <div className="text-[13px] leading-snug text-[#4d5156]">{previewDesc || "Your meta description will show here."}</div>
                  </div>
                </Section>

                <Section title="Search & social" desc="Auto-filled from the title/summary when left blank.">
                  <Field label="SEO title" full>
                    <input className="input" value={seo.title || ""} onChange={(e) => setSeo({ ...seo, title: e.target.value })} />
                  </Field>
                  <Field label="Meta description" full>
                    <textarea className="input" rows={2} value={seo.description || ""} onChange={(e) => setSeo({ ...seo, description: e.target.value })} />
                  </Field>
                  <Field label="Keywords" full hint="Comma-separated.">
                    <input className="input" value={seo.keywords || ""} onChange={(e) => setSeo({ ...seo, keywords: e.target.value })} />
                  </Field>
                  <Field label="Canonical override (full URL)" full>
                    <input className="input" value={seo.canonical_override || ""} onChange={(e) => setSeo({ ...seo, canonical_override: e.target.value })} placeholder="https://…" />
                  </Field>
                  <Field label="OG title">
                    <input className="input" value={seo.og_title || ""} onChange={(e) => setSeo({ ...seo, og_title: e.target.value })} />
                  </Field>
                  <Field label="OG description">
                    <input className="input" value={seo.og_description || ""} onChange={(e) => setSeo({ ...seo, og_description: e.target.value })} />
                  </Field>
                  <ImageUploadField label="OG image" folder="resources/seo" value={seo.og_image || null} onChange={(url) => setSeo({ ...seo, og_image: url })} />
                  <Field label="Indexing & schema" full>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <label className="flex items-center gap-2"><input type="checkbox" checked={!!seo.noindex} onChange={(e) => setSeo({ ...seo, noindex: e.target.checked })} /> No-index</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={!!seo.nofollow} onChange={(e) => setSeo({ ...seo, nofollow: e.target.checked })} /> No-follow</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={seo.structured_data_enabled !== false} onChange={(e) => setSeo({ ...seo, structured_data_enabled: e.target.checked })} /> Structured data (JSON-LD)</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={faq.length > 0 ? seo.faq_schema_enabled !== false : !!seo.faq_schema_enabled} onChange={(e) => setSeo({ ...seo, faq_schema_enabled: e.target.checked })} /> FAQ schema {faq.length > 0 ? `(${faq.length} Q&A)` : ""}</label>
                    </div>
                  </Field>
                </Section>
              </>
            ),
          },
          {
            id: "journey",
            label: "Journey",
            content: (
              <Section title="Chronological journey (Day 1 → Exam)" desc="Place this guide in the beginner roadmap. Leave stage blank to keep it out of the journey.">
                <Field label="Journey stage">
                  <select className="input" value={journeyStage} onChange={(e) => setJourneyStage(e.target.value)}>
                    <option value="">— Not in journey —</option>
                    {JOURNEY_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Order index" hint="Ascending position across the whole roadmap (1, 2, 3…). Also orders public listings.">
                  <input type="number" className="input" value={orderIndex} onChange={(e) => setOrderIndex(e.target.value === "" ? "" : Number(e.target.value))} placeholder="e.g. 10" />
                </Field>
                <Field label="Local SEO page" full hint="Turn on for Chandigarh/Tricity/Himachal coaching pages — adds LocalBusiness schema + local CTAs.">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isLocal} onChange={(e) => setIsLocal(e.target.checked)} /> This is a local coaching page</label>
                </Field>
              </Section>
            ),
          },
          {
            id: "related",
            label: "Related & CTA",
            content: (
              <>
                <Section title="Internal-link suggestions" desc="Auto-suggested by category/subject/tag/keyword overlap. Add the ones that fit — this builds the internal link graph Google rewards.">
                  {suggestions.length === 0 ? (
                    <p className="text-sm text-ink2 sm:col-span-2">No suggestions yet — add tags, a category and a focus keyword, then publish related articles.</p>
                  ) : (
                    <div className="sm:col-span-2 space-y-2">
                      {suggestions.map((s) => (
                        <div key={s.slug} className="flex items-center gap-3 rounded-xl border border-line p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{s.title}</p>
                            <p className="truncate text-xs text-ink2">{s.reason}</p>
                          </div>
                          <button type="button" className="btn btn-secondary ml-auto text-xs" onClick={() => setRelated({ ...related, resource_slugs: [...(related.resource_slugs || []), s.slug] })}>+ Add</button>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Section title="Related resources" desc="These appear as a 'Related reads' block + feed prev/next.">
                  <div className="sm:col-span-2 max-h-56 space-y-1.5 overflow-auto">
                    {meta.resources.filter((r) => r.slug !== slug).map((r) => (
                      <label key={r.slug} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                        <input type="checkbox" checked={(related.resource_slugs || []).includes(r.slug)} onChange={() => setRelated({ ...related, resource_slugs: toggle(related.resource_slugs, r.slug) })} />
                        <span className="truncate">{r.title}</span>
                      </label>
                    ))}
                    {meta.resources.length === 0 && <p className="text-sm text-ink2">No other resources yet.</p>}
                  </div>
                </Section>

                <Section title="Related quizzes / webinars / courses">
                  <Field label="Quizzes" full>
                    <div className="flex flex-wrap gap-2">
                      {meta.quizzes.map((q) => (
                        <button type="button" key={q.slug} onClick={() => setRelated({ ...related, quiz_slugs: toggle(related.quiz_slugs, q.slug) })} className={`pill ${(related.quiz_slugs || []).includes(q.slug) ? "pill-blue" : "pill-gray"}`}>{q.title}</button>
                      ))}
                      {meta.quizzes.length === 0 && <span className="text-sm text-ink2">No quizzes.</span>}
                    </div>
                  </Field>
                  <Field label="Webinars" full>
                    <div className="flex flex-wrap gap-2">
                      {meta.webinars.map((w) => (
                        <button type="button" key={w.slug} onClick={() => setRelated({ ...related, webinar_slugs: toggle(related.webinar_slugs, w.slug) })} className={`pill ${(related.webinar_slugs || []).includes(w.slug) ? "pill-blue" : "pill-gray"}`}>{w.title}</button>
                      ))}
                      {meta.webinars.length === 0 && <span className="text-sm text-ink2">No webinars.</span>}
                    </div>
                  </Field>
                  <Field label="Courses" full>
                    <div className="flex flex-wrap gap-2">
                      {meta.courses.map((c) => (
                        <button type="button" key={c.slug} onClick={() => setRelated({ ...related, course_slugs: toggle(related.course_slugs, c.slug) })} className={`pill ${(related.course_slugs || []).includes(c.slug) ? "pill-blue" : "pill-gray"}`}>{c.title}</button>
                      ))}
                      {meta.courses.length === 0 && <span className="text-sm text-ink2">No courses.</span>}
                    </div>
                  </Field>
                </Section>

                <Section title="Call-to-action blocks" desc="Tasteful CTAs rendered on the article. Add a preset, then edit the copy.">
                  <div className="sm:col-span-2 flex flex-wrap gap-2">
                    {CTA_PRESETS.map((p) => (
                      <button type="button" key={p.kind} onClick={() => addCtaPreset(p.kind)} className="btn btn-secondary text-xs capitalize">+ {p.kind}</button>
                    ))}
                    <button type="button" onClick={() => addCtaPreset("custom")} className="btn btn-secondary text-xs">+ custom</button>
                  </div>
                  <div className="sm:col-span-2 space-y-3">
                    {ctaBlocks.map((c, i) => (
                      <div key={i} className="rounded-xl border border-line p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="pill pill-gray text-xs capitalize">{c.kind}</span>
                          <label className="ml-auto flex items-center gap-1 text-xs"><input type="checkbox" checked={c.enabled !== false} onChange={(e) => updateCta(i, { enabled: e.target.checked })} /> Enabled</label>
                          <button type="button" onClick={() => removeCta(i)} className="text-xs text-danger">Remove</button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input className="input" placeholder="Title" value={c.title || ""} onChange={(e) => updateCta(i, { title: e.target.value })} />
                          <input className="input" placeholder="CTA label" value={c.cta_label || ""} onChange={(e) => updateCta(i, { cta_label: e.target.value })} />
                          <input className="input sm:col-span-2" placeholder="Description" value={c.description || ""} onChange={(e) => updateCta(i, { description: e.target.value })} />
                          <input className="input sm:col-span-2" placeholder="Link (e.g. /courses or /webinars/slug)" value={c.href || ""} onChange={(e) => updateCta(i, { href: e.target.value })} />
                        </div>
                      </div>
                    ))}
                    {ctaBlocks.length === 0 && <p className="text-sm text-ink2">No CTA blocks yet.</p>}
                  </div>
                </Section>
              </>
            ),
          },
          {
            id: "publish",
            label: "Publish",
            content: (
              <Section title="Status & schedule" desc="Scheduled/future-dated resources stay hidden until their time.">
                <Field label="Status">
                  <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ResourceStatus)}>
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </Field>
                <Field label="Publish date & time" hint="Future = scheduled. Blank + Published = now.">
                  <input type="datetime-local" className="input" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
                </Field>
                {!isNew && (
                  <Field label="Preview" full>
                    <a href={`/resources/${resource!.slug}?preview=1`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary text-sm">Open preview ↗</a>
                  </Field>
                )}
              </Section>
            ),
          },
        ]}
      />
      <FormActions saving={saving} onSave={save} cancelHref={BACK} saveLabel={isNew ? "Create resource" : "Save changes"} />
    </FormShell>
  );
}
