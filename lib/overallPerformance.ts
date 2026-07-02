import type { Quiz, QuizAttempt, QuizAnswer, QuizOptionKey } from "./types";
import type { TopicStat } from "./quizScoring";

/**
 * ============================================================================
 *  OVERALL PERFORMANCE AGGREGATION — pure & serializable. Aggregates ALL of a
 *  learner's finished attempts into a single self-assessment snapshot for the
 *  Class Hub "Overall Performance" tab. No DB access here; the server supplies
 *  the finished attempts, a quiz-meta map, and (for Section E) the learner's
 *  per-question answers.
 *
 *  Efficiency: Sections A–D are derived from attempt-level counts + the
 *  `result_summary.subject_breakdown` / `topic_breakdown` already persisted at
 *  scoring time (no per-question scan). Section E ("most-missed questions") uses
 *  the answers — which, for a SHARED question bank (a question can recur across
 *  quizzes), makes a repeat-miss metric meaningful.
 * ============================================================================
 */

export type MasteryBand = "strong" | "moderate" | "weak";

export interface OverallHero {
  totalQuizzes: number;      // distinct quizzes attempted
  totalAttempts: number;     // finished attempts (data points)
  totalQuestions: number;    // questions faced across all attempts
  correct: number;
  incorrect: number;
  skipped: number;
  accuracy: number;          // correct / attempted
  attemptRate: number;       // attempted / faced
  unattemptedRate: number;   // skipped / faced
}

export interface MasteryRow {
  label: string;
  subject: string | null;
  correct: number;
  incorrect: number;
  attempted: number;
  total: number;
  accuracy: number; // correct / attempted
  quizzes: number;  // # attempts that included this bucket
  band: MasteryBand;
}

export interface QuizRankRow {
  attemptId: string;
  quizId: string;
  slug: string | null;
  title: string;
  subject: string | null;
  dateISO: string | null;
  score: number;
  maxScore: number;
  accuracy: number;
  reviewable: boolean;
}

export interface TrendPoint {
  attemptId: string;
  label: string;
  dateISO: string | null;
  accuracy: number;
  title: string;
}

export type TrendDirection = "improving" | "steady" | "declining" | "insufficient";

export interface MissedOption {
  key: QuizOptionKey;
  html: string;
}

export interface MissedQuestion {
  questionId: string;
  text: string;                    // plain-text stem for the collapsed row
  subject: string | null;
  topic: string | null;
  wrong: number; // times answered incorrectly
  seen: number;  // times this question appeared in the learner's attempts
  // ---- Rich review payload for the expanded accordion panel (mini per-attempt
  // card). Sourced from a representative wrong answer's snapshot; correct option
  // and explanation are reveal-gated per the owning quiz's result_settings,
  // mirroring the per-attempt report (buildResultPayload). Never fabricated —
  // fields stay null/empty when the snapshot or reveal settings withhold them.
  questionHtml: string;
  questionImage: string | null;
  options: MissedOption[];
  yourOption: QuizOptionKey | null;   // the learner's (wrong) pick
  correctOption: QuizOptionKey | null; // null when the quiz hides answers
  explanationHtml: string | null;      // null when the quiz hides explanations
}

export interface OverallPerformance {
  studentName: string;
  batchLabel: string;
  snapshotISO: string;
  hasData: boolean;
  hero: OverallHero;
  subjects: MasteryRow[]; // weakest-first
  topics: MasteryRow[];   // weakest-first
  quizzes: QuizRankRow[]; // highest accuracy first
  trend: TrendPoint[];    // chronological (oldest → newest)
  trendDirection: TrendDirection;
  focusTopics: MasteryRow[];
  mostMissed: MissedQuestion[];
}

// `result_settings` is optional so callers that only have basic quiz metadata
// still satisfy the type; it's used to reveal-gate the most-missed review panel.
export type QuizMeta = Pick<Quiz, "id" | "slug" | "title" | "subject"> & {
  result_settings?: Quiz["result_settings"];
};

const OPTION_KEYS: QuizOptionKey[] = ["A", "B", "C", "D", "E"];

const round = (n: number) => Math.round(n);
const attemptTime = (a: QuizAttempt) => Date.parse(a.submitted_at || a.created_at) || 0;

function band(accuracy: number): MasteryBand {
  if (accuracy >= 75) return "strong";
  if (accuracy >= 40) return "moderate";
  return "weak";
}

/** Strip HTML/entities to a short plain-text preview (question stems can be rich). */
function toPlainText(html?: string | null): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function emptyOverall(studentName: string, batchLabel: string, now: number): OverallPerformance {
  return {
    studentName,
    batchLabel,
    snapshotISO: new Date(now).toISOString(),
    hasData: false,
    hero: {
      totalQuizzes: 0, totalAttempts: 0, totalQuestions: 0,
      correct: 0, incorrect: 0, skipped: 0,
      accuracy: 0, attemptRate: 0, unattemptedRate: 0,
    },
    subjects: [], topics: [], quizzes: [], trend: [],
    trendDirection: "insufficient", focusTopics: [], mostMissed: [],
  };
}

function accumulate(
  map: Map<string, { label: string; subject: string | null; correct: number; incorrect: number; total: number; quizzes: number }>,
  stat: TopicStat,
) {
  const key = stat.label || "Uncategorized";
  const cur = map.get(key) || { label: key, subject: stat.subject ?? null, correct: 0, incorrect: 0, total: 0, quizzes: 0 };
  cur.correct += stat.correct || 0;
  cur.incorrect += stat.incorrect || 0;
  cur.total += stat.total || 0;
  cur.quizzes += 1;
  if (!cur.subject && stat.subject) cur.subject = stat.subject;
  map.set(key, cur);
}

function toRows(map: Map<string, { label: string; subject: string | null; correct: number; incorrect: number; total: number; quizzes: number }>): MasteryRow[] {
  return [...map.values()]
    .map((v) => {
      const attempted = v.correct + v.incorrect;
      const accuracy = attempted ? round((v.correct / attempted) * 100) : 0;
      return { label: v.label, subject: v.subject, correct: v.correct, incorrect: v.incorrect, attempted, total: v.total, accuracy, quizzes: v.quizzes, band: band(accuracy) };
    })
    // Weakest-first: lowest accuracy, then larger samples surface first on ties.
    .sort((a, b) => a.accuracy - b.accuracy || b.attempted - a.attempted || a.label.localeCompare(b.label));
}

export function buildOverallPerformance(opts: {
  attempts: QuizAttempt[];
  quizById: Map<string, QuizMeta>;
  answers?: QuizAnswer[];
  studentName: string;
  batchLabel: string;
  now?: number;
}): OverallPerformance {
  const { attempts, quizById, answers = [], studentName, batchLabel, now = Date.now() } = opts;

  const finished = attempts
    .filter((a) => a.status !== "IN_PROGRESS")
    .sort((a, b) => attemptTime(a) - attemptTime(b));

  if (finished.length === 0) return emptyOverall(studentName, batchLabel, now);

  // ---- A. Hero totals ----
  let correct = 0, incorrect = 0, skipped = 0;
  const quizIds = new Set<string>();
  for (const a of finished) {
    correct += a.correct_count;
    incorrect += a.incorrect_count;
    skipped += a.unattempted_count;
    quizIds.add(a.quiz_id);
  }
  const faced = correct + incorrect + skipped;
  const attempted = correct + incorrect;
  const hero: OverallHero = {
    totalQuizzes: quizIds.size,
    totalAttempts: finished.length,
    totalQuestions: faced,
    correct, incorrect, skipped,
    accuracy: attempted ? round((correct / attempted) * 100) : 0,
    attemptRate: faced ? round((attempted / faced) * 100) : 0,
    unattemptedRate: faced ? round((skipped / faced) * 100) : 0,
  };

  // ---- B. Subject / topic mastery (from stored breakdowns — no per-Q scan) ----
  const subjMap = new Map<string, { label: string; subject: string | null; correct: number; incorrect: number; total: number; quizzes: number }>();
  const topicMap = new Map<string, { label: string; subject: string | null; correct: number; incorrect: number; total: number; quizzes: number }>();
  for (const a of finished) {
    const rs = a.result_summary as { subject_breakdown?: TopicStat[]; topic_breakdown?: TopicStat[] } | null;
    const sb = Array.isArray(rs?.subject_breakdown) ? rs!.subject_breakdown : [];
    const tb = Array.isArray(rs?.topic_breakdown) ? rs!.topic_breakdown : [];
    for (const s of sb) accumulate(subjMap, s);
    for (const t of tb) accumulate(topicMap, t);
  }
  const subjects = toRows(subjMap);
  const topics = toRows(topicMap);

  // ---- C. Best & weakest quizzes ----
  const quizzes: QuizRankRow[] = finished
    .map((a) => {
      const q = quizById.get(a.quiz_id);
      const totalQ = a.correct_count + a.incorrect_count + a.unattempted_count;
      return {
        attemptId: a.id,
        quizId: a.quiz_id,
        slug: q?.slug ?? null,
        title: q?.title ?? "Quiz",
        subject: q?.subject ?? null,
        dateISO: a.submitted_at || a.created_at || null,
        score: a.score,
        maxScore: a.max_score,
        accuracy: round(a.accuracy),
        reviewable: totalQ > 0,
      };
    })
    .sort((a, b) => b.accuracy - a.accuracy || (Date.parse(b.dateISO || "") || 0) - (Date.parse(a.dateISO || "") || 0));

  // ---- D. Accuracy trend over time ----
  const trend: TrendPoint[] = finished.map((a) => ({
    attemptId: a.id,
    label: shortDate(a.submitted_at || a.created_at || null),
    dateISO: a.submitted_at || a.created_at || null,
    accuracy: round(a.accuracy),
    title: quizById.get(a.quiz_id)?.title ?? "Quiz",
  }));

  let trendDirection: TrendDirection = "insufficient";
  if (trend.length >= 2) {
    const half = Math.floor(trend.length / 2);
    const firstAvg = trend.slice(0, half).reduce((s, p) => s + p.accuracy, 0) / Math.max(1, half);
    const lastSlice = trend.slice(trend.length - half);
    const lastAvg = lastSlice.reduce((s, p) => s + p.accuracy, 0) / Math.max(1, lastSlice.length);
    const diff = lastAvg - firstAvg;
    trendDirection = diff >= 5 ? "improving" : diff <= -5 ? "declining" : "steady";
  }

  // ---- E. Focus areas — weakest topics with a meaningful sample ----
  const meaningful = topics.filter((t) => t.attempted >= 3);
  const focusPool = meaningful.length ? meaningful : topics;
  const focusTopics = focusPool.filter((t) => t.band !== "strong").slice(0, 5);

  // Most-missed questions (SHARED bank → repeat misses are real signal).
  const missMap = new Map<string, MissedQuestion>();
  for (const ans of answers) {
    const snap = ans.answer_snapshot || {};
    let cur = missMap.get(ans.question_id);
    if (!cur) {
      cur = {
        questionId: ans.question_id,
        text: toPlainText(snap.question_html) || "Question",
        subject: snap.subject ?? null,
        topic: snap.topic ?? null,
        wrong: 0,
        seen: 0,
        questionHtml: snap.question_html || "",
        questionImage: snap.question_image ?? null,
        options: [],
        yourOption: null,
        correctOption: null,
        explanationHtml: null,
      };
      missMap.set(ans.question_id, cur);
    }
    cur.seen += 1;
    if (!cur.text || cur.text === "Question") cur.text = toPlainText(snap.question_html) || cur.text;

    const isWrong = !ans.is_unattempted && !ans.is_correct;
    if (isWrong) {
      cur.wrong += 1;
      // Capture the full review payload from the FIRST wrong answer we see for
      // this question (representative). Correct option + explanation are gated by
      // the owning quiz's reveal settings, exactly like the per-attempt report.
      if (cur.options.length === 0) {
        const quiz = quizById.get(ans.quiz_id);
        const rs = quiz?.result_settings || {};
        const revealAfter = rs.reveal_explanations_after
          ? Date.parse(rs.reveal_explanations_after) > now
          : false;
        const reveal = !revealAfter;
        const opts = (snap.options || {}) as Record<string, string | null>;
        cur.options = OPTION_KEYS.filter((k) => opts[k]).map((k) => ({ key: k, html: opts[k] || "" }));
        cur.questionHtml = snap.question_html || cur.questionHtml;
        cur.questionImage = snap.question_image ?? cur.questionImage;
        cur.yourOption = (ans.selected_option as QuizOptionKey) || null;
        cur.correctOption = rs.show_correct_answers !== false && reveal ? (snap.correct_option as QuizOptionKey) || null : null;
        cur.explanationHtml = rs.show_explanations !== false && reveal ? snap.explanation_html || null : null;
      }
    }
  }
  const mostMissed = [...missMap.values()]
    .filter((m) => m.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || b.seen - a.seen || a.text.localeCompare(b.text))
    .slice(0, 5);

  return {
    studentName,
    batchLabel,
    snapshotISO: new Date(now).toISOString(),
    hasData: true,
    hero,
    subjects,
    topics,
    quizzes,
    trend,
    trendDirection,
    focusTopics,
    mostMissed,
  };
}
