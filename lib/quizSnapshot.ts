import type { Question, QuestionSnapshot } from "./types";

/** Build an immutable snapshot of a question for versioning inside a quiz/attempt. */
export function buildSnapshot(q: Question): QuestionSnapshot {
  return {
    question_html: q.question_html,
    question_image: q.question_image ?? null,
    options: q.options,
    correct_option: q.correct_option,
    explanation_html: q.explanation_html ?? null,
    short_explanation: q.short_explanation ?? null,
    subject: q.subject ?? null,
    topic: q.topic ?? null,
    difficulty: q.difficulty,
  };
}
