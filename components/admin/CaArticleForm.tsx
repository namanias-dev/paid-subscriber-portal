"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormShell, Section, Field, FormActions, Tabs } from "./FormKit";
import { ImageUploadField, StringListEditor, PageSectionsEditor } from "./FormFields";
import RichTextEditor from "./RichTextEditor";
import { useToast } from "@/components/ui/Toast";
import {
  DEFAULT_CA_CATEGORIES,
  CA_ARTICLE_TYPES,
  CA_GS_PAPERS,
} from "@/lib/caConstants";
import type {
  CaArticle,
  CaArticleType,
  CaStatus,
  CaSeo,
  CaUpsc,
  CaQuickRevision,
  CaGsPaper,
  CaExamRelevance,
  CaDifficulty,
  CrossSell,
  PageSection,
} from "@/lib/types";

const BACK = "/admin/current-affairs";

function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface MetaPicker {
  categories: { slug: string; name: string }[];
  tags: { slug: string; name: string }[];
  pdfs: { id: string; title: string; kind: string }[];
  quizzes: { slug: string; title: string }[];
}

export default function CaArticleForm({ article }: { article?: CaArticle }) {
  const router = useRouter();
  const { toast } = useToast();
  const isNew = !article?.id;

  const [title, setTitle] = useState(article?.title || "");
  const [slug, setSlug] = useState(article?.slug || "");
  const [summary, setSummary] = useState(article?.summary || "");
  const [articleType, setArticleType] = useState<CaArticleType>(article?.article_type || "daily");
  const [status, setStatus] = useState<CaStatus>(article?.status || "draft");
  const [publishAt, setPublishAt] = useState(toLocalInput(article?.publish_at));
  const [caDate, setCaDate] = useState(article?.ca_date || new Date().toISOString().slice(0, 10));
  const [author, setAuthor] = useState(article?.author || "");
  const [readingTime, setReadingTime] = useState<number | "">(article?.reading_time ?? "");
  const [featuredImage, setFeaturedImage] = useState<string | null>(article?.featured_image || null);
  const [thumbnailImage, setThumbnailImage] = useState<string | null>(article?.thumbnail_image || null);
  const [mobileImage, setMobileImage] = useState<string | null>(article?.mobile_image || null);

  const [bodyHtml, setBodyHtml] = useState(article?.body_html || "");
  const [sections, setSections] = useState<PageSection[]>(article?.sections || []);

  const [categorySlug, setCategorySlug] = useState(article?.category_slug || "");
  const [tags, setTags] = useState<string[]>(article?.tags || []);

  const [qr, setQr] = useState<CaQuickRevision>(article?.quick_revision || {});
  const [upsc, setUpsc] = useState<CaUpsc>(article?.upsc || {});

  const [important, setImportant] = useState(!!article?.important);
  const [trending, setTrending] = useState(!!article?.trending);
  const [showOnHome, setShowOnHome] = useState(!!article?.show_on_home);
  const [inDaily, setInDaily] = useState(article?.in_daily !== false);
  const [inMonthly, setInMonthly] = useState(article?.in_monthly !== false);

  const [relatedQuizSlug, setRelatedQuizSlug] = useState(article?.related_quiz_slug || "");
  const [pdfIds, setPdfIds] = useState<string[]>(article?.pdf_ids || []);
  const [crossSell, setCrossSell] = useState<CrossSell>(article?.cross_sell || {});
  const [seo, setSeo] = useState<CaSeo>(article?.seo || {});

  const [meta, setMeta] = useState<MetaPicker>({ categories: [], tags: [], pdfs: [], quizzes: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/current-affairs/meta")
      .then((r) => r.json())
      .then((d) => d.meta && setMeta(d.meta))
      .catch(() => {});
  }, []);

  // Merge DB categories with the canonical grid so all are selectable.
  const categoryOptions = (() => {
    const map = new Map<string, string>();
    DEFAULT_CA_CATEGORIES.forEach((c) => map.set(c.slug, c.name));
    meta.categories.forEach((c) => map.set(c.slug, c.name));
    return Array.from(map.entries()).map(([slug, name]) => ({ slug, name }));
  })();

  function toggleGsPaper(p: CaGsPaper) {
    const cur = upsc.gs_papers || [];
    setUpsc({ ...upsc, gs_papers: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] });
  }

  function togglePdf(id: string) {
    setPdfIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function save() {
    if (!title.trim()) return toast("Title is required", "error");
    if (status === "published") {
      if (!summary.trim()) return toast("Summary is required to publish.", "error");
      if (!categorySlug) return toast("Pick a category before publishing.", "error");
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      slug: slug.trim() || undefined,
      summary: summary.trim(),
      article_type: articleType,
      status,
      publish_at:
        status === "published" && !publishAt
          ? new Date().toISOString()
          : publishAt
          ? new Date(publishAt).toISOString()
          : null,
      ca_date: caDate || null,
      author: author.trim() || null,
      reading_time: readingTime === "" ? null : Number(readingTime),
      featured_image: featuredImage,
      thumbnail_image: thumbnailImage,
      mobile_image: mobileImage,
      body_html: bodyHtml || null,
      sections: sections.filter((s) => s.title?.trim()),
      category_slug: categorySlug || null,
      tags,
      quick_revision: qr,
      upsc,
      important,
      trending,
      show_on_home: showOnHome,
      in_daily: inDaily,
      in_monthly: inMonthly,
      related_quiz_slug: relatedQuizSlug || null,
      pdf_ids: pdfIds,
      cross_sell: crossSell,
      seo,
    };
    const res = await fetch(isNew ? "/api/admin/current-affairs" : `/api/admin/current-affairs/${article!.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (data.ok) {
      toast(isNew ? "Article created" : "Article updated", "success");
      router.push(BACK);
      router.refresh();
    } else {
      toast(data.error || "Failed to save", "error");
    }
  }

  return (
    <FormShell
      title={isNew ? "Create Article" : "Edit Article"}
      subtitle="Public page is generated at /current-affairs/<slug>"
      backHref={BACK}
    >
      <Tabs
        items={[
          {
            id: "basic",
            label: "Basic",
            content: (
              <>
                <Section title="Basics" desc="Core fields shown across the site.">
                  <Field label="Title" full>
                    <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Daily Current Affairs — 1 Jan" />
                  </Field>
                  <Field label="Slug (URL)" hint="Leave blank to auto-generate from the title.">
                    <input className="input" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} placeholder="daily-current-affairs-1-jan" />
                  </Field>
                  <Field label="Article type" hint="A filter/badge — never a separate page.">
                    <select className="input" value={articleType} onChange={(e) => setArticleType(e.target.value as CaArticleType)}>
                      {CA_ARTICLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Summary" full hint="1–2 lines; also used as the meta description fallback.">
                    <textarea className="input" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
                  </Field>
                  <Field label="Category">
                    <select className="input" value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)}>
                      <option value="">— Select —</option>
                      {categoryOptions.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Author / faculty">
                    <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Naman Sir" />
                  </Field>
                  <Field label="Current affairs date">
                    <input type="date" className="input" value={caDate} onChange={(e) => setCaDate(e.target.value)} />
                  </Field>
                  <Field label="Reading time (min)" hint="Leave blank to auto-calculate.">
                    <input type="number" min={0} className="input" value={readingTime} onChange={(e) => setReadingTime(e.target.value === "" ? "" : Number(e.target.value))} />
                  </Field>
                </Section>
                <Section title="Tags" desc="Multiple tags allowed; used for tag pages and related articles.">
                  <StringListEditor value={tags} onChange={setTags} placeholder="e.g. parliament" addLabel="+ Add tag" />
                </Section>
                <Section title="Images" desc="Used in cards, hero and social shares.">
                  <ImageUploadField label="Featured image" folder="current-affairs" value={featuredImage} onChange={setFeaturedImage} hint="Recommended 1200×630." />
                  <ImageUploadField label="Thumbnail" folder="current-affairs" value={thumbnailImage} onChange={setThumbnailImage} hint="Square/landscape card image." />
                  <ImageUploadField label="Mobile image (optional)" folder="current-affairs" value={mobileImage} onChange={setMobileImage} />
                </Section>
              </>
            ),
          },
          {
            id: "content",
            label: "Content",
            content: (
              <>
                <Section title="Quick Revision box" desc="Shown at the top of the article for fast revision.">
                  <Field label="Bullet points (3–6)" full>
                    <StringListEditor value={qr.bullets} onChange={(v) => setQr({ ...qr, bullets: v })} placeholder="Key revision point" addLabel="+ Add bullet" />
                  </Field>
                  <Field label="Why in News">
                    <input className="input" value={qr.why_in_news || ""} onChange={(e) => setQr({ ...qr, why_in_news: e.target.value })} />
                  </Field>
                  <Field label="UPSC Relevance">
                    <input className="input" value={qr.upsc_relevance || ""} onChange={(e) => setQr({ ...qr, upsc_relevance: e.target.value })} />
                  </Field>
                  <Field label="Exam Angle" full>
                    <input className="input" value={qr.exam_angle || ""} onChange={(e) => setQr({ ...qr, exam_angle: e.target.value })} />
                  </Field>
                </Section>
                <Section title="Article body" desc="Rich text — headings, lists, tables, blockquotes, images, links.">
                  <Field label="Body" full>
                    <RichTextEditor value={bodyHtml} onChange={setBodyHtml} placeholder="Write the article…" />
                  </Field>
                </Section>
                <Section title="Flexible sections" desc="Optional ordered blocks rendered after the body (with visibility toggle).">
                  <PageSectionsEditor value={sections} onChange={setSections} folder="current-affairs/sections" />
                </Section>
              </>
            ),
          },
          {
            id: "upsc",
            label: "UPSC Relevance",
            content: (
              <Section title="UPSC metadata" desc="Drives badges and admin filters.">
                <Field label="Topic">
                  <input className="input" value={upsc.topic || ""} onChange={(e) => setUpsc({ ...upsc, topic: e.target.value })} />
                </Field>
                <Field label="Subtopic">
                  <input className="input" value={upsc.subtopic || ""} onChange={(e) => setUpsc({ ...upsc, subtopic: e.target.value })} />
                </Field>
                <Field label="GS papers" full>
                  <div className="flex flex-wrap gap-2">
                    {CA_GS_PAPERS.map((p) => (
                      <button
                        type="button"
                        key={p}
                        onClick={() => toggleGsPaper(p)}
                        className={`pill ${(upsc.gs_papers || []).includes(p) ? "pill-blue" : "pill-gray"}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Exam relevance">
                  <select className="input" value={upsc.exam_relevance || ""} onChange={(e) => setUpsc({ ...upsc, exam_relevance: (e.target.value || null) as CaExamRelevance | null })}>
                    <option value="">—</option>
                    <option value="prelims">Prelims</option>
                    <option value="mains">Mains</option>
                    <option value="interview">Interview</option>
                    <option value="both">Both</option>
                  </select>
                </Field>
                <Field label="Difficulty">
                  <select className="input" value={upsc.difficulty || ""} onChange={(e) => setUpsc({ ...upsc, difficulty: (e.target.value || null) as CaDifficulty | null })}>
                    <option value="">—</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </Field>
                <Field label="Syllabus tags" full>
                  <StringListEditor value={upsc.syllabus_tags} onChange={(v) => setUpsc({ ...upsc, syllabus_tags: v })} placeholder="e.g. Indian Polity" addLabel="+ Add syllabus tag" />
                </Field>
                <Field label="Source type">
                  <input className="input" value={upsc.source_type || ""} onChange={(e) => setUpsc({ ...upsc, source_type: e.target.value })} placeholder="e.g. The Hindu / PIB" />
                </Field>
                <Field label="Source note / reference" full>
                  <input className="input" value={upsc.source_note || ""} onChange={(e) => setUpsc({ ...upsc, source_note: e.target.value })} />
                </Field>
              </Section>
            ),
          },
          {
            id: "media",
            label: "Media / PDF",
            content: (
              <Section title="Attach PDFs" desc="Pick from the PDF Library. Upload new PDFs in the PDF Library page.">
                {meta.pdfs.length === 0 ? (
                  <p className="text-sm text-ink2 sm:col-span-2">No PDFs yet. Add some in the PDF Library.</p>
                ) : (
                  <div className="sm:col-span-2 space-y-2">
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
            ),
          },
          {
            id: "seo",
            label: "SEO",
            content: (
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
                <Field label="Canonical slug">
                  <input className="input" value={seo.canonical_slug || ""} onChange={(e) => setSeo({ ...seo, canonical_slug: e.target.value })} />
                </Field>
                <Field label="Canonical override (full URL)">
                  <input className="input" value={seo.canonical_override || ""} onChange={(e) => setSeo({ ...seo, canonical_override: e.target.value })} placeholder="https://…" />
                </Field>
                <Field label="OG title">
                  <input className="input" value={seo.og_title || ""} onChange={(e) => setSeo({ ...seo, og_title: e.target.value })} />
                </Field>
                <Field label="OG description">
                  <input className="input" value={seo.og_description || ""} onChange={(e) => setSeo({ ...seo, og_description: e.target.value })} />
                </Field>
                <ImageUploadField label="OG image" folder="current-affairs/seo" value={seo.og_image || null} onChange={(url) => setSeo({ ...seo, og_image: url })} />
                <Field label="Indexing & schema" full>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!seo.noindex} onChange={(e) => setSeo({ ...seo, noindex: e.target.checked })} /> No-index</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!seo.nofollow} onChange={(e) => setSeo({ ...seo, nofollow: e.target.checked })} /> No-follow</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={seo.structured_data_enabled !== false} onChange={(e) => setSeo({ ...seo, structured_data_enabled: e.target.checked })} /> Structured data (JSON-LD)</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!seo.faq_schema_enabled} onChange={(e) => setSeo({ ...seo, faq_schema_enabled: e.target.checked })} /> FAQ schema</label>
                  </div>
                </Field>
              </Section>
            ),
          },
          {
            id: "related",
            label: "Related & Promote",
            content: (
              <>
                <Section title="Related quiz" desc="Link an existing quiz; its MCQs surface on the article.">
                  <Field label="Quiz" full>
                    <select className="input" value={relatedQuizSlug} onChange={(e) => setRelatedQuizSlug(e.target.value)}>
                      <option value="">— None —</option>
                      {meta.quizzes.map((q) => <option key={q.slug} value={q.slug}>{q.title}</option>)}
                    </select>
                  </Field>
                </Section>
                <Section title="Course cross-sell" desc="A tasteful promo block on the article.">
                  <label className="flex items-center gap-3 sm:col-span-2">
                    <input type="checkbox" checked={!!crossSell.enabled} onChange={(e) => setCrossSell({ ...crossSell, enabled: e.target.checked })} />
                    <span className="text-sm"><b>{crossSell.enabled ? "Enabled" : "Disabled"}</b></span>
                  </label>
                  <Field label="Promo title">
                    <input className="input" value={crossSell.title || ""} onChange={(e) => setCrossSell({ ...crossSell, title: e.target.value })} />
                  </Field>
                  <Field label="CTA label">
                    <input className="input" value={crossSell.cta_label || ""} onChange={(e) => setCrossSell({ ...crossSell, cta_label: e.target.value })} placeholder="Explore →" />
                  </Field>
                  <Field label="Description" full>
                    <textarea className="input" rows={2} value={crossSell.description || ""} onChange={(e) => setCrossSell({ ...crossSell, description: e.target.value })} />
                  </Field>
                  <Field label="Course link">
                    <input className="input" value={crossSell.href || ""} onChange={(e) => setCrossSell({ ...crossSell, href: e.target.value })} placeholder="/courses/…" />
                  </Field>
                  <Field label="Promo code (optional)">
                    <input className="input uppercase" value={crossSell.promo_code || ""} onChange={(e) => setCrossSell({ ...crossSell, promo_code: e.target.value.toUpperCase() })} />
                  </Field>
                </Section>
              </>
            ),
          },
          {
            id: "publish",
            label: "Publish Settings",
            content: (
              <>
                <Section title="Status & schedule" desc="Scheduled/future-dated articles stay hidden until their time.">
                  <Field label="Status">
                    <select className="input" value={status} onChange={(e) => setStatus(e.target.value as CaStatus)}>
                      <option value="draft">Draft</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="published">Published</option>
                      <option value="archived">Archived</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </Field>
                  <Field label="Publish date & time" hint="Future = scheduled. Blank + Published = now.">
                    <input type="datetime-local" className="input" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
                  </Field>
                </Section>
                <Section title="Placement toggles">
                  <Field label="Flags" full>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <label className="flex items-center gap-2"><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /> Important</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={trending} onChange={(e) => setTrending(e.target.checked)} /> Trending</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={showOnHome} onChange={(e) => setShowOnHome(e.target.checked)} /> Show on homepage</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={inDaily} onChange={(e) => setInDaily(e.target.checked)} /> In daily digest</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={inMonthly} onChange={(e) => setInMonthly(e.target.checked)} /> In monthly compilation</label>
                    </div>
                  </Field>
                  {!isNew && (
                    <Field label="Preview" full>
                      <a href={`/current-affairs/${article!.slug}?preview=1`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary text-sm">Open preview ↗</a>
                    </Field>
                  )}
                </Section>
              </>
            ),
          },
        ]}
      />
      <FormActions saving={saving} onSave={save} cancelHref={BACK} saveLabel={isNew ? "Create article" : "Save changes"} />
    </FormShell>
  );
}
