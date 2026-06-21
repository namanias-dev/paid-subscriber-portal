import type { Quiz, QuizQuestion, QuizAttempt, QuizOptionKey } from "./types";

export interface ClientQuestion {
  question_id: string;
  order: number;
  question_html: string;
  question_image: string | null;
  options: { key: QuizOptionKey; html: string }[];
  subject: string | null;
  topic: string | null;
  difficulty: string | null;
  section: string | null;
}

/** Compute the attempt expiry timestamp from the quiz timer settings. */
export function attemptExpiry(quiz: Quiz, startedAtISO: string): string | null {
  if (!quiz.timing_settings?.time_limit_enabled || !quiz.time_limit_minutes) return null;
  return new Date(Date.parse(startedAtISO) + quiz.time_limit_minutes * 60_000).toISOString();
}

/** Has a server-based timer expired for this attempt? */
export function isAttemptExpired(attempt: QuizAttempt): boolean {
  if (!attempt.expires_at) return false;
  return Date.now() > Date.parse(attempt.expires_at) + 2000; // 2s grace
}

/** Build the question display order (optionally randomized), returns question_ids. */
export function buildOrder(quizQuestions: QuizQuestion[], randomize: boolean): string[] {
  const sorted = [...quizQuestions].sort((a, b) => a.order_index - b.order_index);
  const ids = sorted.map((q) => q.question_id);
  if (!randomize) return ids;
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

const OPTION_KEYS: QuizOptionKey[] = ["A", "B", "C", "D", "E"];

/** Client-safe questions — NO correct answers or explanations leaked. */
export function clientQuestions(quizQuestions: QuizQuestion[], order: string[], randomizeOptions = false): ClientQuestion[] {
  const map = new Map(quizQuestions.map((qq) => [qq.question_id, qq]));
  const out: ClientQuestion[] = [];
  order.forEach((qid, i) => {
    const qq = map.get(qid);
    if (!qq) return;
    const snap = qq.snapshot || {};
    const opts = (snap.options || {}) as Record<string, string | null>;
    let keys = OPTION_KEYS.filter((k) => opts[k]);
    if (randomizeOptions) {
      keys = [...keys];
      for (let j = keys.length - 1; j > 0; j--) {
        const r = Math.floor(Math.random() * (j + 1));
        [keys[j], keys[r]] = [keys[r], keys[j]];
      }
    }
    out.push({
      question_id: qid,
      order: i + 1,
      question_html: snap.question_html || "",
      question_image: snap.question_image || null,
      options: keys.map((k) => ({ key: k, html: opts[k] || "" })),
      subject: snap.subject || null,
      topic: snap.topic || null,
      difficulty: snap.difficulty || null,
      section: qq.section || null,
    });
  });
  return out;
}

/** Disclaimer that must appear on every result and PDF. */
export const QUIZ_DISCLAIMER =
  "UPSC Prelims-style practice test by Naman IAS Academy. Not an official UPSC document.";
