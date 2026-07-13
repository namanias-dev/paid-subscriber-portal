import type { QuizAttempt, Student, CourseEnrollment } from "./types";
import type { QuizMeta } from "./overallPerformance";
import { buildLeaderboard, leaderboardBatchKey, isCompletedAttempt, attemptDurationSeconds } from "./leaderboard";
import {
  LEADERBOARD_MIN_COHORT,
  SCORE_BAND_LABELS,
  scoreBandIndex,
} from "./leaderboardConfig";

/**
 * ============================================================================
 *  STUDENT ↔ BATCH COMPARISON — privacy-safe projection of the leaderboard.
 *
 *  Reuses the EXACT same aggregation as the admin leaderboard (buildLeaderboard:
 *  qualified set, global exclude list, Reliability ranking, classAverage,
 *  score-band distribution) so a student's numbers MATCH the admin view by
 *  construction — no forked math. We then throw away every other student's row
 *  and return ONLY anonymous aggregates + the CALLER'S OWN position. No names,
 *  phones or identifiable rows ever leave this function.
 *
 *  The batch is derived SERVER-SIDE from the authenticated caller's own
 *  enrollments (never a client-supplied batch), so a student can only ever be
 *  compared within a batch they actually belong to.
 * ============================================================================
 */

export interface StudentBatchComparison {
  /** True only when there is a real batch AND a large-enough cohort to compare. */
  available: boolean;
  /** Why a comparison is/ isn't shown (drives the UI copy). */
  reason: "ok" | "no_batch" | "small_cohort" | "not_ranked";
  /** Cohort-size threshold below which we suppress (small-cohort privacy guard). */
  minCohort: number;
  /** Qualified, exclusion-cleaned batchmates (incl. the caller when ranked). */
  cohortSize: number;
  /** Batch display title (e.g. "Safalta 2025 — Morning"), or null when no batch. */
  batchTitle: string | null;
  /** Mean raw accuracy of the qualified cohort (0–100). */
  classAverage: number;
  /** The caller's OWN position — never anyone else's. */
  you: {
    accuracy: number;      // raw accuracy % (matches their dashboard)
    rank: number;          // 1 = top, by fair Reliability ranking
    topPercent: number;    // ceil(rank / cohortSize * 100), 1..100
    bandIndex: number;     // which score band the caller sits in (0..4)
    isTopHalf: boolean;    // topPercent <= 50 → OK to show "top X%" framing
  } | null;
  /** Anonymous score-band histogram of the cohort (counts only, no identities). */
  scoreBands: number[];
  bandLabels: readonly string[];
  /** Positive "closest next tier" nudge (rank-based), or null when top-tier/N-A. */
  nextTier: { label: string; spots: number } | null;
}

/** Tiers we nudge toward, best-first. Reserved for encouraging, never shaming. */
const NEXT_TIERS: { pct: number; label: string }[] = [
  { pct: 10, label: "Top 10%" },
  { pct: 25, label: "Top 25%" },
  { pct: 50, label: "Top 50%" },
];

const norm = (p: string | null | undefined) => (p || "").trim();

/**
 * The batch key a student should be compared within, derived from THEIR OWN
 * enrollments only. `preferCourseId` (the class being viewed) picks among the
 * caller's batches; it can never scope to a batch they don't belong to. Returns
 * null when the caller has no batch enrollment. Shared by the API (to pull the
 * roster's attempts) and buildStudentBatchComparison (to aggregate) so both agree.
 */
export function chooseStudentBatchKey(
  enrollments: CourseEnrollment[],
  learnerPhone: string,
  preferCourseId?: string | null,
): string | null {
  const phone = norm(learnerPhone);
  if (!phone) return null;
  const own = enrollments.filter((e) => e.course_id && norm(e.phone) === phone);
  if (own.length === 0) return null;
  const keyed = own.map((e) => ({ key: leaderboardBatchKey(e.course_id, e.batch_label), courseId: e.course_id }));
  const chosen = (preferCourseId && keyed.find((k) => k.courseId === preferCourseId)) || keyed[0];
  return chosen.key;
}

function empty(reason: StudentBatchComparison["reason"], batchTitle: string | null, cohortSize = 0): StudentBatchComparison {
  return {
    available: false,
    reason,
    minCohort: LEADERBOARD_MIN_COHORT,
    cohortSize,
    batchTitle,
    classAverage: 0,
    you: null,
    scoreBands: [0, 0, 0, 0, 0],
    bandLabels: SCORE_BAND_LABELS,
    nextTier: null,
  };
}

/**
 * Build the caller's batch comparison. `preferCourseId` (the class the student is
 * viewing) only PICKS which of the caller's own batches to compare within — it is
 * matched against the caller's enrollments, so it can never scope to a batch they
 * aren't in. When it matches nothing, we fall back to the caller's primary batch.
 */
export function buildStudentBatchComparison(opts: {
  learnerStudentId: string | null;
  learnerPhone: string;
  preferCourseId?: string | null;
  students: Student[];
  enrollments: CourseEnrollment[];
  attempts: QuizAttempt[];
  quizById: Map<string, QuizMeta>;
  excludedStudentIds?: Iterable<string>;
  reliabilityC?: number;
  now?: number;
}): StudentBatchComparison {
  const { learnerStudentId, learnerPhone, preferCourseId } = opts;
  if (!learnerStudentId) return empty("no_batch", null);

  const batchKey = chooseStudentBatchKey(opts.enrollments, learnerPhone, preferCourseId);
  if (!batchKey) return empty("no_batch", null);

  const result = buildLeaderboard({
    students: opts.students,
    enrollments: opts.enrollments,
    attempts: opts.attempts,
    quizById: opts.quizById,
    batchKey,
    quizId: null, // compare across ALL quizzes in the batch (matches Part A intent)
    excludedStudentIds: opts.excludedStudentIds,
    reliabilityC: opts.reliabilityC,
    now: opts.now,
  });

  const batchTitle = result.batchLabel;
  const cohortSize = result.studentCount;

  // Small-cohort privacy suppression (also avoids divide-by-zero downstream).
  if (cohortSize < LEADERBOARD_MIN_COHORT) return empty("small_cohort", batchTitle, cohortSize);

  // Rows are sorted by Reliability (rank 1 = best). Find the caller's OWN row.
  const idx = result.rows.findIndex((r) => r.studentId === learnerStudentId);
  if (idx < 0) {
    // Caller isn't in the qualified/ non-excluded set (e.g. excluded, or no
    // completed attempt in this batch) → no personal position to show.
    return empty("not_ranked", batchTitle, cohortSize);
  }

  const meRow = result.rows[idx];
  const rank = idx + 1;
  const topPercent = Math.max(1, Math.ceil((rank / cohortSize) * 100));

  // Closest better tier the caller hasn't reached yet (positive nudge only).
  let nextTier: StudentBatchComparison["nextTier"] = null;
  for (const t of [...NEXT_TIERS].reverse()) {
    const thresholdRank = Math.max(1, Math.ceil((t.pct / 100) * cohortSize));
    if (rank > thresholdRank) {
      nextTier = { label: t.label, spots: rank - thresholdRank };
      break;
    }
  }

  return {
    available: true,
    reason: "ok",
    minCohort: LEADERBOARD_MIN_COHORT,
    cohortSize,
    batchTitle,
    classAverage: result.classAverage,
    you: {
      accuracy: meRow.accuracy,
      rank,
      topPercent,
      bandIndex: scoreBandIndex(meRow.accuracy),
      isTopHalf: topPercent <= 50,
    },
    scoreBands: result.analytics.accuracyBands,
    bandLabels: SCORE_BAND_LABELS,
    nextTier,
  };
}

/* ==========================================================================
 *  FACULTY variant — the ADMIN coaching view. Same buildLeaderboard math, but:
 *   • NO student-facing softening (below-average / bottom is shown honestly).
 *   • NO small-cohort suppression (N=10) — faculty always see the real number;
 *     genuinely tiny cohorts are flagged `limited` rather than hidden.
 *   • Exposes the EXACT "rank #X of N", avg-time-vs-batch, and (when a quiz is in
 *     context) the quiz-average comparison — all matching the leaderboard for the
 *     same student/batch by construction (same buildLeaderboard call).
 *   • Admin-only endpoint; the shape carries no other student's identity.
 * ========================================================================== */

/** Below this cohort size a number is technically real but not very meaningful. */
const FACULTY_LIMITED_COHORT = 3;

export interface FacultyStudentComparison {
  available: boolean;                 // false only when the scope has no cohort
  reason: "ok" | "no_batch" | "not_ranked" | "empty";
  limited: boolean;                   // true ⇒ cohort tiny → show "limited cohort data"
  scopeLabel: string;                 // "All batches" or the batch title
  cohortSize: number;                 // N (qualified, exclusion-cleaned) — honest
  classAverage: number;               // batch avg accuracy
  you: {
    accuracy: number;
    rank: number;                     // exact #X (1 = top)
    topPercent: number;               // rank / N * 100 (honest — can be high)
    bandIndex: number;
    diff: number;                     // accuracy − classAverage (negative = below)
  } | null;
  scoreBands: number[];               // batch accuracy-band histogram (counts)
  bandLabels: readonly string[];
  timeTracked: boolean;
  batchAvgTimeSeconds: number;
  youAvgTimeSeconds: number | null;   // student's own mean time (null when untracked)
  quizContext: {
    quizTitle: string;
    quizAverage: number;              // avg accuracy across cohort on this quiz
    youScore: number | null;          // student's accuracy on this quiz
    rank: number | null;
    cohortSize: number;
  } | null;
}

/** Mean usable duration over a student's COMPLETED attempts, or null if untracked. */
function meanOwnTime(studentAttempts: QuizAttempt[]): number | null {
  let sum = 0, n = 0;
  for (const a of studentAttempts) {
    if (!isCompletedAttempt(a)) continue;
    const d = attemptDurationSeconds(a);
    if (d != null) { sum += d; n++; }
  }
  return n ? Math.round(sum / n) : null;
}

export function buildFacultyStudentComparison(opts: {
  studentId: string;
  studentAttempts: QuizAttempt[];
  batchKey: string | null;            // resolved cohort scope (null = all batches)
  quizId?: string | null;
  quizTitle?: string | null;
  students: Student[];
  enrollments: CourseEnrollment[];
  attempts: QuizAttempt[];
  quizById: Map<string, QuizMeta>;
  excludedStudentIds?: Iterable<string>;
  reliabilityC?: number;
  now?: number;
}): FacultyStudentComparison {
  const result = buildLeaderboard({
    students: opts.students,
    enrollments: opts.enrollments,
    attempts: opts.attempts,
    quizById: opts.quizById,
    batchKey: opts.batchKey,
    quizId: null, // headline standing is across ALL quizzes (matches board default)
    excludedStudentIds: opts.excludedStudentIds,
    reliabilityC: opts.reliabilityC,
    now: opts.now,
  });

  const scopeLabel = result.batchLabel;
  const cohortSize = result.studentCount;
  const youAvgTimeSeconds = meanOwnTime(opts.studentAttempts);

  // Optional quiz-in-context comparison (a second scoped pass — same roster pull).
  let quizContext: FacultyStudentComparison["quizContext"] = null;
  if (opts.quizId) {
    const q = buildLeaderboard({
      students: opts.students,
      enrollments: opts.enrollments,
      attempts: opts.attempts,
      quizById: opts.quizById,
      batchKey: opts.batchKey,
      quizId: opts.quizId,
      excludedStudentIds: opts.excludedStudentIds,
      reliabilityC: opts.reliabilityC,
      now: opts.now,
    });
    const qi = q.rows.findIndex((r) => r.studentId === opts.studentId);
    quizContext = {
      quizTitle: opts.quizTitle || "Selected quiz",
      quizAverage: q.classAverage,
      youScore: qi >= 0 ? q.rows[qi].accuracy : null,
      rank: qi >= 0 ? qi + 1 : null,
      cohortSize: q.studentCount,
    };
  }

  const base = {
    scopeLabel,
    cohortSize,
    limited: cohortSize > 0 && cohortSize < FACULTY_LIMITED_COHORT,
    classAverage: result.classAverage,
    scoreBands: result.analytics.accuracyBands,
    bandLabels: SCORE_BAND_LABELS,
    timeTracked: result.analytics.timeTracked,
    batchAvgTimeSeconds: result.analytics.avgTimeSeconds,
    youAvgTimeSeconds,
    quizContext,
  };

  if (cohortSize === 0) {
    return { available: false, reason: "empty", you: null, ...base };
  }

  const idx = result.rows.findIndex((r) => r.studentId === opts.studentId);
  if (idx < 0) {
    // Cohort exists but this student has no qualifying attempt in scope — still
    // return honest cohort figures (average, bands) so faculty see the context.
    return { available: true, reason: "not_ranked", you: null, ...base };
  }

  const meRow = result.rows[idx];
  const rank = idx + 1;
  return {
    available: true,
    reason: "ok",
    you: {
      accuracy: meRow.accuracy,
      rank,
      topPercent: Math.max(1, Math.ceil((rank / cohortSize) * 100)),
      bandIndex: scoreBandIndex(meRow.accuracy),
      diff: Math.round((meRow.accuracy - result.classAverage) * 10) / 10,
    },
    ...base,
  };
}
