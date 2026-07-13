/**
 * ============================================================================
 *  LEADERBOARD CONFIG — single source of truth shared by the admin leaderboard,
 *  its API, and any future student-facing leaderboard/ranking view.
 *
 *  Holds:
 *   • The confidence constant C for the fair "Reliability Score" (admin-tunable).
 *   • The shape + normaliser for the admin-managed leaderboard settings that are
 *     persisted as one row (site_settings.leaderboard jsonb) — the GLOBAL,
 *     single-source-of-truth exclude list + tuned C.
 *   • The plain-language copy explaining the Reliability Score to students/admins.
 *
 *  Pure & serialisable — no DB access here.
 * ============================================================================
 */

/**
 * Confidence / shrinkage constant for the Reliability Score. Think of it as
 * "how many average quizzes we add to everyone's record". Small ⇒ real accuracy
 * shows through faster; large ⇒ more proof (quizzes) needed to move off the
 * class average. Admin-tunable via site_settings.leaderboard.reliabilityC.
 */
export const LEADERBOARD_DEFAULT_C = 3;

/** Sane bounds so a bad config value can never break ranking (no negative / absurd C). */
export const LEADERBOARD_MIN_C = 0;
export const LEADERBOARD_MAX_C = 50;

/**
 * Minimum cohort size before we expose a student's rank / percentile / batch
 * distribution back to them. Below this, tiny batches could quasi-identify
 * classmates (and a "rank 2 of 3" is both noisy and easy to shame), so the
 * student-facing comparison + the per-attempt rank/percentile are suppressed and
 * the UI shows a warm "not enough data yet" state instead. Tune here only.
 */
export const LEADERBOARD_MIN_COHORT = 10;

/** Human labels for the 5 score bands, shared by admin + student distributions. */
export const SCORE_BAND_LABELS = ["0–20%", "21–40%", "41–60%", "61–80%", "81–100%"] as const;

/** 0–100% accuracy → band index 0..4 (the 81–100 band includes exactly 100). */
export function scoreBandIndex(pct: number): number {
  return Math.min(4, Math.max(0, Math.floor(pct / 20)));
}

export function clampReliabilityC(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : LEADERBOARD_DEFAULT_C;
  return Math.min(LEADERBOARD_MAX_C, Math.max(LEADERBOARD_MIN_C, n));
}

/**
 * Confidence-adjusted (shrinkage) average:
 *   reliability = (n * studentAccuracy + C * classAverage) / (n + C)
 * All accuracies are 0–100 percentages; result is the same unit, rounded to 1dp.
 * Safe when n = 0 (⇒ classAverage) and when C = 0 with n > 0 (⇒ studentAccuracy);
 * only n + C = 0 (n = 0 AND C = 0) collapses to classAverage to avoid /0.
 */
export function reliabilityScore(n: number, studentAccuracy: number, classAverage: number, C: number): number {
  const denom = n + C;
  const raw = denom > 0 ? (n * studentAccuracy + C * classAverage) / denom : classAverage;
  return Math.round(raw * 10) / 10;
}

/**
 * Admin-managed, persisted leaderboard settings. GLOBAL scope: the SAME list
 * drives the admin leaderboard and any student-facing leaderboard, so ranks &
 * scores are always consistent across views. Excluded students are removed from
 * ranking AND from every aggregate (cohort size, class average, ranks).
 *
 * Exclusions are stored by STABLE `students.id` (never by name) — the UI lets an
 * admin search by name or phone, but persists the resolved id, matching the
 * safe design of the built-in staff exclusions (avoids dropping real namesakes).
 */
export interface LeaderboardSettings {
  /** Admin-managed excluded students, by stable students.id. */
  excludedStudentIds: string[];
  /** Admin-tuned confidence constant C (defaults to LEADERBOARD_DEFAULT_C). */
  reliabilityC: number;
}

export const DEFAULT_LEADERBOARD_SETTINGS: LeaderboardSettings = {
  excludedStudentIds: [],
  reliabilityC: LEADERBOARD_DEFAULT_C,
};

/** Coerce an untrusted jsonb blob into a valid, deduped LeaderboardSettings. */
export function normalizeLeaderboardSettings(raw: unknown): LeaderboardSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawIds = Array.isArray(obj.excludedStudentIds) ? obj.excludedStudentIds : [];
  const ids = [...new Set(rawIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()))];
  return {
    excludedStudentIds: ids,
    reliabilityC: clampReliabilityC(obj.reliabilityC),
  };
}

/**
 * Plain-language, warm explanation of the Reliability Score. Shared by the admin
 * info popover and any student-facing leaderboard so the wording never diverges.
 */
export const RELIABILITY_INFO = {
  title: "What is the Reliability Score?",
  lead:
    "The Reliability Score rewards consistency. We add a few \u201caverage\u201d quizzes to everyone\u2019s record, so a great score from just 1\u20132 quizzes won\u2019t outrank someone who has proven themselves across many quizzes.",
  detail:
    "The more quizzes you attempt, the more your real accuracy shows through \u2014 and the less the \u201caverage\u201d padding matters.",
  example:
    "Example: 2 quizzes at 100% can score lower than 5 quizzes at 75%, because two quizzes isn\u2019t enough proof yet. Keep attempting and your true accuracy takes over.",
} as const;
