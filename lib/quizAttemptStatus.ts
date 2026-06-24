import { getAttemptsByUser } from "./dataProvider";
import type { Learner } from "./entitlements";

/**
 * Per-quiz attempt status for a logged-in learner — the SINGLE source for the
 * "✓ Attempted + score + report/PDF" UI shown on /quizzes, quiz detail, and the
 * Class Hub. Keyed by quiz id; the latest submitted attempt wins. Reports + PDFs
 * are always rebuilt on-demand from stored attempt data via the existing
 * /api/public/quiz/result + /quiz-print routes, so even pre-existing attempts
 * get a full report with no extra storage.
 */
export interface QuizAttemptStatus {
  attemptId: string;
  score: number;
  maxScore: number;
  /** Number of finished (submitted/auto-submitted) attempts on this quiz. */
  attemptCount: number;
  submittedAt: string | null;
}

const timeOf = (a: { submitted_at: string | null; created_at: string }) =>
  Date.parse(a.submitted_at || a.created_at) || 0;

/** Map of quizId → latest finished attempt status for this learner ({} if logged out). */
export async function getAttemptStatusForLearner(
  learner: Learner | null,
): Promise<Record<string, QuizAttemptStatus>> {
  if (!learner?.studentId) return {};
  const attempts = await getAttemptsByUser(learner.studentId);
  const map: Record<string, QuizAttemptStatus> = {};
  const bestTime: Record<string, number> = {};

  for (const a of attempts) {
    if (a.status === "IN_PROGRESS") continue;
    const t = timeOf(a);
    const seen = map[a.quiz_id];
    if (!seen) {
      map[a.quiz_id] = { attemptId: a.id, score: a.score, maxScore: a.max_score, attemptCount: 1, submittedAt: a.submitted_at };
      bestTime[a.quiz_id] = t;
      continue;
    }
    seen.attemptCount += 1;
    if (t >= bestTime[a.quiz_id]) {
      map[a.quiz_id] = { ...seen, attemptId: a.id, score: a.score, maxScore: a.max_score, submittedAt: a.submitted_at };
      bestTime[a.quiz_id] = t;
    }
  }
  return map;
}
