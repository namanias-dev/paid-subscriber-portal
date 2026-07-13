import type { QuizAttempt, Student, CourseEnrollment } from "./types";
import { computePercentile } from "./quizScoring";
import { isCompletedAttempt, leaderboardBatchKey } from "./leaderboard";
import { LEADERBOARD_EXCLUDED_STUDENT_IDS } from "./leaderboardExclusions";
import { LEADERBOARD_MIN_COHORT } from "./leaderboardConfig";
import {
  getAttemptsByQuiz, getStudents, getAllCourseEnrollments, getLeaderboardSettings,
} from "./dataProvider";

/**
 * ============================================================================
 *  PER-ATTEMPT RANK / PERCENTILE — batch-scoped + exclusion-aware.
 *
 *  The per-attempt Rank/Percentile shown on a quiz result must line up with the
 *  Performance Leaderboard: computed only over QUALIFIED (completed), NON-GUEST,
 *  NON-EXCLUDED attempts, and scoped to the student's OWN batch (same batch
 *  grouping + global exclude list the leaderboard uses). This removes the skew
 *  from guests / staff / test accounts and from other batches.
 *
 *  Reuses the leaderboard's own primitives (leaderboardBatchKey, isCompletedAttempt,
 *  the built-in exclude ids) and the existing computePercentile — no forked math.
 *  Pure `computeScopedRankPercentile` powers BOTH submit-time persistence and
 *  read-time recompute (so historical attempts display corrected values too).
 * ============================================================================
 */

export interface ScopedRank {
  rank: number | null;
  percentile: number | null;
  /** Distinct qualified, non-excluded, non-guest students in the scoped cohort. */
  cohortSize: number;
  /** false ⇒ student had no batch, so we fell back to a quiz-wide clean cohort. */
  batchScoped: boolean;
  /** true ⇒ suppressed for a small cohort (< minCohort) → rank/percentile null. */
  suppressed: boolean;
}

const norm = (p: string | null | undefined) => (p || "").trim();

const SUPPRESSED = (cohortSize: number, batchScoped: boolean): ScopedRank => ({
  rank: null, percentile: null, cohortSize, batchScoped, suppressed: true,
});

/**
 * Rank + percentile of one attempt among the clean, batch-scoped cohort for its
 * quiz. Pure: caller supplies all data (one batched pull each), so it's reusable
 * at submit-time and on read with no N+1.
 */
export function computeScopedRankPercentile(opts: {
  quizId: string;
  attemptId: string;
  score: number;
  userId: string | null;
  quizAttempts: QuizAttempt[];
  students: Student[];
  enrollments: CourseEnrollment[];
  excludedStudentIds?: Iterable<string>;
  minCohort?: number;
}): ScopedRank {
  const minCohort = opts.minCohort ?? LEADERBOARD_MIN_COHORT;

  // Guests are never ranked (no batch, and the leaderboard ignores them too).
  if (!opts.userId) return { rank: null, percentile: null, cohortSize: 0, batchScoped: false, suppressed: false };

  const excluded = new Set<string>(LEADERBOARD_EXCLUDED_STUDENT_IDS);
  if (opts.excludedStudentIds) for (const id of opts.excludedStudentIds) if (id) excluded.add(id);

  // Excluded target (staff/test) → no rank, mirroring the leaderboard.
  if (excluded.has(opts.userId)) return { rank: null, percentile: null, cohortSize: 0, batchScoped: false, suppressed: false };

  // phone → set of batch keys (a student may be in several batches).
  const batchKeysByPhone = new Map<string, Set<string>>();
  for (const e of opts.enrollments) {
    const phone = norm(e.phone);
    if (!phone || !e.course_id) continue;
    const key = leaderboardBatchKey(e.course_id, e.batch_label);
    const set = batchKeysByPhone.get(phone) || new Set<string>();
    set.add(key);
    batchKeysByPhone.set(phone, set);
  }

  const phoneById = new Map<string, string>();
  for (const s of opts.students) phoneById.set(s.id, norm(s.phone));

  const targetPhone = phoneById.get(opts.userId) || "";
  const targetBatchKeys = batchKeysByPhone.get(targetPhone) || new Set<string>();
  const batchScoped = targetBatchKeys.size > 0;

  // Eligible cohort attempts: completed, non-guest, non-excluded, and (when the
  // student has a batch) sharing at least one batch with the target.
  const cohortStudents = new Set<string>();
  const otherScores: number[] = [];
  for (const a of opts.quizAttempts) {
    if (!a.user_id || !isCompletedAttempt(a)) continue;
    if (excluded.has(a.user_id)) continue;
    if (batchScoped) {
      const keys = batchKeysByPhone.get(phoneById.get(a.user_id) || "");
      if (!keys) continue;
      let shares = false;
      for (const k of keys) if (targetBatchKeys.has(k)) { shares = true; break; }
      if (!shares) continue;
    }
    cohortStudents.add(a.user_id);
    if (a.id !== opts.attemptId) otherScores.push(a.score);
  }

  const cohortSize = cohortStudents.size;
  // Small-cohort suppression (privacy + avoids noisy "rank 2 of 3").
  if (cohortSize < minCohort) return SUPPRESSED(cohortSize, batchScoped);

  const rank = 1 + otherScores.filter((s) => s > opts.score).length;
  const percentile = computePercentile(opts.score, otherScores);
  return { rank, percentile, cohortSize, batchScoped, suppressed: false };
}

/**
 * DB-backed convenience wrapper: fetches the single batched pull of this quiz's
 * attempts + the roster/exclusion inputs, then computes the scoped rank. Used at
 * submit-time and on read. Fails soft (nulls) so a result page never breaks.
 */
export async function getScopedRankPercentile(attempt: QuizAttempt): Promise<ScopedRank> {
  if (!attempt.user_id) return { rank: null, percentile: null, cohortSize: 0, batchScoped: false, suppressed: false };
  try {
    const [quizAttempts, students, enrollments, settings] = await Promise.all([
      getAttemptsByQuiz(attempt.quiz_id),
      getStudents(),
      getAllCourseEnrollments(),
      getLeaderboardSettings(),
    ]);
    return computeScopedRankPercentile({
      quizId: attempt.quiz_id,
      attemptId: attempt.id,
      score: attempt.score,
      userId: attempt.user_id,
      quizAttempts,
      students,
      enrollments,
      excludedStudentIds: settings.excludedStudentIds,
    });
  } catch {
    return { rank: null, percentile: null, cohortSize: 0, batchScoped: false, suppressed: false };
  }
}
