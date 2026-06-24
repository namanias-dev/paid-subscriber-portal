import type { Quiz, QuizAttempt, QuizType, ClassHubView } from "./types";
import type { QuizAttemptStatus } from "./quizAttemptStatus";

/**
 * ============================================================================
 *  STUDENT PERFORMANCE AGGREGATION — pure & serializable. No DB access here;
 *  the server supplies the learner's finished attempts + quiz metadata + the
 *  set of currently-available (entitled) quizzes + class_hub_views. We derive
 *  hero counts, subject analytics, insights and a reviewable attempt history.
 *  Reports + PDFs are NOT rebuilt here — the history reuses the existing
 *  result + print routes via the shared attempt-status piece.
 * ============================================================================
 */

export const PERFORMANCE_SECTION = "performance";

export interface PerfHero {
  available: number;
  attempted: number;
  pending: number;
  avgAccuracy: number;
  bestSubject: string | null;
  focusSubject: string | null;
  totalQuestions: number;
  totalAttempts: number;
  /** Accuracy of the last N attempts, oldest → newest, for a sparkline. */
  sparkline: number[];
}

export interface PerfAvailableQuiz {
  id: string;
  slug: string;
  title: string;
  subject: string | null;
  category: string;
  isPaid: boolean;
  attempt: QuizAttemptStatus | null;
  isNew: boolean;
}

export interface PerfSubject {
  subject: string;
  attempts: number;
  avgAccuracy: number;
  correct: number;
  wrong: number;
  /** Accuracy per attempt over time (oldest → newest). */
  trend: number[];
}

export interface PerfHistoryRow {
  attemptId: string;
  quizId: string;
  slug: string | null;
  title: string;
  subject: string | null;
  category: string;
  dateISO: string | null;
  score: number;
  maxScore: number;
  accuracy: number;
  timeTakenSeconds: number | null;
  /** False for legacy score-only attempts with no stored per-question data. */
  reviewable: boolean;
}

export interface PerformanceData {
  hero: PerfHero;
  quizzes: PerfAvailableQuiz[];
  subjects: PerfSubject[];
  history: PerfHistoryRow[];
  newCount: number;
  insight: string | null;
}

export function quizCategory(type: QuizType): string {
  if (type === "FullMock" || type === "Sectional") return "Test Series";
  if (type === "CurrentAffairs") return "Current Affairs";
  if (type === "Daily" || type === "Subject" || type === "Topic") return "Prelims MCQs";
  return "Quiz";
}

const attemptTime = (a: QuizAttempt) => Date.parse(a.submitted_at || a.created_at) || 0;
const round = (n: number) => Math.round(n);

export function buildPerformanceData(opts: {
  attempts: QuizAttempt[];
  quizById: Map<string, Pick<Quiz, "id" | "slug" | "title" | "subject" | "type" | "requires_payment">>;
  available: Pick<Quiz, "id" | "slug" | "title" | "subject" | "type" | "requires_payment" | "created_at">[];
  attemptStatus: Record<string, QuizAttemptStatus>;
  views: ClassHubView[];
  courseId: string;
  now?: number;
}): PerformanceData {
  const { attempts, quizById, available, attemptStatus, views, courseId, now = Date.now() } = opts;

  // Finished attempts only, oldest → newest (stable order for trends/sparkline).
  const finished = attempts
    .filter((a) => a.status !== "IN_PROGRESS")
    .sort((a, b) => attemptTime(a) - attemptTime(b));

  // ---- Hero counts driven by the AVAILABLE (entitled) set ----
  const attemptedAvailable = available.filter((q) => attemptStatus[q.id]).length;

  // ---- Accuracy / subject analytics driven by ALL finished attempts ----
  const totalQuestions = finished.reduce(
    (sum, a) => sum + a.correct_count + a.incorrect_count + a.unattempted_count,
    0,
  );
  const avgAccuracy = finished.length
    ? round(finished.reduce((s, a) => s + a.accuracy, 0) / finished.length)
    : 0;
  const sparkline = finished.slice(-12).map((a) => round(a.accuracy));

  // Subject aggregation (subject comes from the quiz).
  const subjMap = new Map<string, { attempts: number; accSum: number; correct: number; wrong: number; trend: number[] }>();
  for (const a of finished) {
    const subject = quizById.get(a.quiz_id)?.subject || null;
    if (!subject) continue;
    const cur = subjMap.get(subject) || { attempts: 0, accSum: 0, correct: 0, wrong: 0, trend: [] };
    cur.attempts += 1;
    cur.accSum += a.accuracy;
    cur.correct += a.correct_count;
    cur.wrong += a.incorrect_count;
    cur.trend.push(round(a.accuracy));
    subjMap.set(subject, cur);
  }
  const subjects: PerfSubject[] = [...subjMap.entries()]
    .map(([subject, v]) => ({
      subject,
      attempts: v.attempts,
      avgAccuracy: round(v.accSum / v.attempts),
      correct: v.correct,
      wrong: v.wrong,
      trend: v.trend.slice(-10),
    }))
    .sort((a, b) => b.avgAccuracy - a.avgAccuracy);

  const best = subjects[0] || null;
  const focus = subjects.length > 1 ? subjects[subjects.length - 1] : null;
  const insight = best
    ? `Strongest: ${best.subject} (${best.avgAccuracy}%)${focus ? ` · Focus area: ${focus.subject} (${focus.avgAccuracy}%)` : ""}`
    : null;

  // ---- NEW badge: quizzes available after last "performance" visit ----
  const lastSeen = views.find((v) => v.course_id === courseId && v.section === PERFORMANCE_SECTION);
  const lastSeenMs = lastSeen ? Date.parse(lastSeen.last_seen_at) || 0 : 0;

  const quizzes: PerfAvailableQuiz[] = available
    .map((q) => ({
      id: q.id,
      slug: q.slug,
      title: q.title,
      subject: q.subject ?? null,
      category: quizCategory(q.type),
      isPaid: q.requires_payment,
      attempt: attemptStatus[q.id] ?? null,
      isNew: (Date.parse(q.created_at) || 0) > lastSeenMs,
    }))
    .sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      const aDone = a.attempt ? 1 : 0;
      const bDone = b.attempt ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone; // not-attempted first
      return a.title.localeCompare(b.title);
    });

  const newCount = quizzes.filter((q) => q.isNew).length;

  // ---- Reviewable attempt history (latest first) ----
  const history: PerfHistoryRow[] = [...finished]
    .reverse()
    .map((a) => {
      const q = quizById.get(a.quiz_id);
      const totalQ = a.correct_count + a.incorrect_count + a.unattempted_count;
      return {
        attemptId: a.id,
        quizId: a.quiz_id,
        slug: q?.slug ?? null,
        title: q?.title ?? "Quiz",
        subject: q?.subject ?? null,
        category: q ? quizCategory(q.type) : "Quiz",
        dateISO: a.submitted_at || a.created_at || null,
        score: a.score,
        maxScore: a.max_score,
        accuracy: round(a.accuracy),
        timeTakenSeconds: a.time_taken_seconds,
        reviewable: totalQ > 0,
      };
    });

  return {
    hero: {
      available: available.length,
      attempted: attemptedAvailable,
      pending: Math.max(0, available.length - attemptedAvailable),
      avgAccuracy,
      bestSubject: best?.subject ?? null,
      focusSubject: focus?.subject ?? null,
      totalQuestions,
      totalAttempts: finished.length,
      sparkline,
    },
    quizzes,
    subjects,
    history,
    newCount,
    insight,
  };
}
