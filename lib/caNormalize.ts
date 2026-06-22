import { sanitizeHtml } from "./sanitizeHtml";
import type { CaSeo, PageSection } from "./types";
import { ACADEMY } from "./config";

export interface CaNormalizeResult {
  ok: boolean;
  value?: Record<string, unknown>;
  error?: string;
}

export function slugify(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Approx reading time in minutes from rich HTML (200 wpm, min 1). */
export function estimateReadingTime(html: string | null | undefined, extra = ""): number {
  const text = `${html || ""} ${extra}`.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;
  return Math.max(1, Math.round(words / 200));
}

/** Fill SEO fallbacks (never overwrites admin-provided values). */
function withSeoFallbacks(seo: CaSeo, title: string, summary: string, tags: string[], ogFallback: string | null): CaSeo {
  const out: CaSeo = { ...seo };
  if (!out.title?.trim()) out.title = `${title} — UPSC Current Affairs | ${ACADEMY.shortName}`;
  if (!out.description?.trim()) out.description = (summary || title).slice(0, 170);
  if (!out.keywords?.trim() && tags.length) out.keywords = tags.join(", ");
  if (!out.og_image?.trim() && ogFallback) out.og_image = ogFallback;
  return out;
}

/**
 * Normalize, sanitize and apply auto-SEO/reading-time fallbacks for an incoming
 * Current Affairs article create/update body. Only touches present fields so
 * partial PATCH never wipes data. Always refreshes `updated_at`.
 */
export function normalizeCaArticleInput(body: Record<string, unknown>): CaNormalizeResult {
  const out: Record<string, unknown> = { ...body };

  if (typeof out.title === "string") out.title = out.title.trim();
  if (typeof out.slug === "string") out.slug = slugify(out.slug);
  if (!out.slug && typeof out.title === "string" && out.title) out.slug = slugify(out.title);

  if (typeof out.body_html === "string") {
    out.body_html = sanitizeHtml(out.body_html) || null;
  }

  // Flexible ordered sections (sanitize each content block).
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

  // Tags -> clean slug-ish lowercase list.
  if (Array.isArray(out.tags)) {
    out.tags = Array.from(
      new Set((out.tags as unknown[]).map((t) => slugify(String(t))).filter(Boolean))
    );
  }

  // Reading time: auto-calc if not explicitly provided/edited.
  const rt = Number(out.reading_time);
  if (!rt || Number.isNaN(rt)) {
    out.reading_time = estimateReadingTime(typeof out.body_html === "string" ? out.body_html : "", typeof out.summary === "string" ? out.summary : "");
  }

  // SEO fallbacks.
  if (isObj(out.seo)) {
    const title = typeof out.title === "string" ? out.title : "";
    const summary = typeof out.summary === "string" ? out.summary : "";
    const tags = Array.isArray(out.tags) ? (out.tags as string[]) : [];
    const ogFallback =
      (typeof out.featured_image === "string" && out.featured_image) ||
      (typeof out.thumbnail_image === "string" && out.thumbnail_image) ||
      null;
    out.seo = withSeoFallbacks(out.seo as CaSeo, title, summary, tags, ogFallback);
  }

  // Always bump modified time on write.
  out.updated_at = new Date().toISOString();

  return { ok: true, value: out };
}
