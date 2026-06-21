import { sanitizeHtml } from "./sanitizeHtml";
import { questionHash } from "./quizParse";
import type { Question, QuestionOptions, QuizOptionKey } from "./types";

/** Sanitize & normalize an admin-submitted question payload before storage. */
export function sanitizeQuestionInput(body: Record<string, unknown>): Partial<Question> {
  const rawOpts = (body.options || {}) as Record<string, unknown>;
  const options: QuestionOptions = {
    A: sanitizeHtml(String(rawOpts.A || "")),
    B: sanitizeHtml(String(rawOpts.B || "")),
    C: sanitizeHtml(String(rawOpts.C || "")),
    D: sanitizeHtml(String(rawOpts.D || "")),
    E: rawOpts.E ? sanitizeHtml(String(rawOpts.E)) : null,
  };
  const question_html = sanitizeHtml(String(body.question_html || ""));
  const correct = String(body.correct_option || "A").toUpperCase();
  return {
    question_html,
    question_image: body.question_image ? String(body.question_image) : null,
    options,
    correct_option: (["A", "B", "C", "D", "E"].includes(correct) ? correct : "A") as QuizOptionKey,
    explanation_html: body.explanation_html ? sanitizeHtml(String(body.explanation_html)) : null,
    short_explanation: body.short_explanation ? String(body.short_explanation).slice(0, 500) : null,
    subject: body.subject ? String(body.subject) : null,
    topic: body.topic ? String(body.topic) : null,
    subtopic: body.subtopic ? String(body.subtopic) : null,
    difficulty: (body.difficulty as Question["difficulty"]) || "Moderate",
    tags: Array.isArray(body.tags) ? (body.tags as string[]).map(String) : [],
    source: body.source ? String(body.source) : null,
    source_url: body.source_url ? String(body.source_url) : null,
    is_pyq: !!body.is_pyq,
    pyq_year: body.pyq_year ? Number(body.pyq_year) : null,
    current_affairs_date: body.current_affairs_date ? String(body.current_affairs_date) : null,
    language: (body.language as Question["language"]) || "English",
    status: (body.status as Question["status"]) || "draft",
    quality_status: (body.quality_status as Question["quality_status"]) || "unreviewed",
    allow_in_public_quiz: body.allow_in_public_quiz !== false,
    allow_in_paid_quiz: body.allow_in_paid_quiz !== false,
    duplicate_check_hash: questionHash(question_html),
  };
}
