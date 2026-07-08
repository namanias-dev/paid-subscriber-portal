import { sanitizeHtml } from "./sanitizeHtml";
import { slugify, estimateReadingTime } from "./caNormalize";
import { ACADEMY } from "./config";
import type { CaSeo, PageSection, ResourceCta, ResourceRelated } from "./types";

export interface ResourceNormalizeResult {
  ok: boolean;
  value?: Record<string, unknown>;
  error?: string;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function cleanStrList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.map((x) => String(x).trim()).filter(Boolean)));
}

function cleanSlugList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.map((x) => slugify(String(x))).filter(Boolean)));
}

/** SEO fallbacks (never overwrites admin-provided values). */
function withSeoFallbacks(seo: CaSeo, title: string, summary: string, keywords: string, tags: string[], og: string | null): CaSeo {
  const out: CaSeo = { ...seo };
  if (!out.title?.trim()) out.title = `${title} | ${ACADEMY.shortName}`;
  if (!out.description?.trim()) out.description = (summary || title).slice(0, 170);
  if (!out.keywords?.trim()) out.keywords = keywords || (tags.length ? tags.join(", ") : "");
  if (!out.og_image?.trim() && og) out.og_image = og;
  return out;
}

/**
 * Normalize + sanitize an incoming Resource create/update body. Only touches
 * present fields so partial PATCH never wipes data. Always bumps updated_at.
 */
export function normalizeResourceInput(body: Record<string, unknown>): ResourceNormalizeResult {
  const out: Record<string, unknown> = { ...body };

  if (typeof out.title === "string") out.title = out.title.trim();
  if (typeof out.slug === "string") out.slug = slugify(out.slug);
  if (!out.slug && typeof out.title === "string" && out.title) out.slug = slugify(out.title);

  if (typeof out.body_html === "string") out.body_html = sanitizeHtml(out.body_html) || null;

  // Flexible sections (sanitize each content block).
  if (Array.isArray(out.sections)) {
    out.sections = (out.sections as PageSection[]).map((sec, i) => ({
      id: sec.id || `sec-${i}`,
      title: (sec.title || "").toString(),
      subtitle: (sec.subtitle || "").toString().trim() || null,
      content: sec.content ? sanitizeHtml(sec.content) : null,
      image_url: (sec.image_url || "").toString().trim() || null,
      video_url: (sec.video_url || "").toString().trim() || null,
      order: typeof sec.order === "number" ? sec.order : i,
      visible: sec.visible !== false,
    } satisfies PageSection));
  }

  if ("tags" in out) out.tags = cleanSlugList(out.tags);
  if ("pdf_ids" in out) out.pdf_ids = cleanStrList(out.pdf_ids);

  // FAQ — drop blank rows, trim.
  if (Array.isArray(out.faq)) {
    out.faq = (out.faq as { q?: string; a?: string }[])
      .map((f) => ({ q: (f.q || "").toString().trim(), a: (f.a || "").toString().trim() }))
      .filter((f) => f.q && f.a);
  }

  // CTA blocks — drop disabled/empty.
  if (Array.isArray(out.cta_blocks)) {
    out.cta_blocks = (out.cta_blocks as ResourceCta[])
      .map((c) => ({
        kind: c.kind,
        title: (c.title || "").toString().trim() || null,
        description: (c.description || "").toString().trim() || null,
        cta_label: (c.cta_label || "").toString().trim() || null,
        href: (c.href || "").toString().trim() || null,
        enabled: c.enabled !== false,
      } satisfies ResourceCta))
      .filter((c) => c.enabled && (c.title || c.href));
  }

  // Related content selectors → clean slug lists.
  if (isObj(out.related)) {
    const r = out.related as ResourceRelated;
    out.related = {
      resource_slugs: cleanSlugList(r.resource_slugs),
      quiz_slugs: cleanSlugList(r.quiz_slugs),
      webinar_slugs: cleanSlugList(r.webinar_slugs),
      course_slugs: cleanSlugList(r.course_slugs),
    } satisfies ResourceRelated;
  }

  if (typeof out.focus_keyword === "string") out.focus_keyword = out.focus_keyword.trim() || null;

  // Reading time: auto-calc when not explicitly provided.
  const rt = Number(out.reading_time);
  if (!rt || Number.isNaN(rt)) {
    out.reading_time = estimateReadingTime(typeof out.body_html === "string" ? out.body_html : "", typeof out.summary === "string" ? out.summary : "");
  }

  if (out.order_index != null) out.order_index = Number(out.order_index) || 0;

  // SEO fallbacks.
  if (isObj(out.seo)) {
    const title = typeof out.title === "string" ? out.title : "";
    const summary = typeof out.summary === "string" ? out.summary : "";
    const keywords = typeof out.focus_keyword === "string" ? out.focus_keyword : "";
    const tags = Array.isArray(out.tags) ? (out.tags as string[]) : [];
    const og = (typeof out.featured_image === "string" && out.featured_image) || null;
    out.seo = withSeoFallbacks(out.seo as CaSeo, title, summary, keywords, tags, og);
  }

  out.updated_at = new Date().toISOString();
  return { ok: true, value: out };
}
