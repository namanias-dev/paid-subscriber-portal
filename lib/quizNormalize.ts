import { sanitizeHtml } from "./sanitizeHtml";
import type { Quiz } from "./types";

function slugify(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Sanitize & normalize an admin-submitted quiz payload before storage. */
export function normalizeQuizInput(body: Record<string, unknown>): Partial<Quiz> {
  const seo = (body.seo || {}) as Record<string, unknown>;
  const cleanSeo = {
    ...seo,
    public_summary: seo.public_summary ? sanitizeHtml(String(seo.public_summary)) : undefined,
  };

  const out: Partial<Quiz> = {
    title: body.title ? String(body.title) : undefined,
    slug: body.slug ? slugify(String(body.slug)) : body.title ? slugify(String(body.title)) : undefined,
    description: body.description != null ? String(body.description) : undefined,
    instructions_html: body.instructions_html != null ? sanitizeHtml(String(body.instructions_html)) : undefined,
    type: body.type as Quiz["type"] | undefined,
    exam_type: body.exam_type as Quiz["exam_type"] | undefined,
    subject: body.subject != null ? String(body.subject) || null : undefined,
    topic: body.topic != null ? String(body.topic) || null : undefined,
    quiz_date: body.quiz_date != null ? (String(body.quiz_date) || null) : undefined,
    quiz_month: body.quiz_month != null ? (String(body.quiz_month) || null) : undefined,
    quiz_year: body.quiz_year != null ? (Number(body.quiz_year) || null) : undefined,
    difficulty: body.difficulty as Quiz["difficulty"] | undefined,
    language: body.language as Quiz["language"] | undefined,
    thumbnail: body.thumbnail != null ? (String(body.thumbnail) || null) : undefined,
    status: body.status as Quiz["status"] | undefined,
    is_public: typeof body.is_public === "boolean" ? body.is_public : undefined,
    requires_login: typeof body.requires_login === "boolean" ? body.requires_login : undefined,
    requires_payment: typeof body.requires_payment === "boolean" ? body.requires_payment : undefined,
    time_limit_minutes: body.time_limit_minutes != null ? (Number(body.time_limit_minutes) || null) : undefined,
    marks_per_question: body.marks_per_question != null ? Number(body.marks_per_question) : undefined,
    negative_marking_enabled: typeof body.negative_marking_enabled === "boolean" ? body.negative_marking_enabled : undefined,
    negative_fraction: body.negative_fraction != null ? Number(body.negative_fraction) : undefined,
    max_attempts: body.max_attempts != null ? (Number(body.max_attempts) || null) : undefined,
    scoring_settings: (body.scoring_settings as Quiz["scoring_settings"]) || undefined,
    timing_settings: (body.timing_settings as Quiz["timing_settings"]) || undefined,
    attempt_settings: (body.attempt_settings as Quiz["attempt_settings"]) || undefined,
    result_settings: (body.result_settings as Quiz["result_settings"]) || undefined,
    access_rules: (body.access_rules as Quiz["access_rules"]) || undefined,
    seo: cleanSeo as Quiz["seo"],
  };

  // Publishing sets published_at.
  if (out.status === "published" && !body.published_at) out.published_at = new Date().toISOString();

  // Drop undefined keys so PATCH only updates provided fields.
  Object.keys(out).forEach((k) => out[k as keyof Quiz] === undefined && delete out[k as keyof Quiz]);
  return out;
}
