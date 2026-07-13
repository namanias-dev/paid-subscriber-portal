import type { QuizAttempt, Student, CourseEnrollment } from "./types";
import { buildOverallPerformance, type MasteryRow, type QuizMeta } from "./overallPerformance";
import { LEADERBOARD_EXCLUDED_STUDENT_IDS } from "./leaderboardExclusions";
import { LEADERBOARD_DEFAULT_C, reliabilityScore } from "./leaderboardConfig";

/**
 * ============================================================================
 *  BATCH ROSTER / LEADERBOARD AGGREGATION — pure & serializable.
 *
 *  Every per-student figure is produced by the SAME buildOverallPerformance()
 *  used by the student-front + admin per-student dashboards, so a student's
 *  leaderboard row ALWAYS equals their own dashboard (no divergent second
 *  calculation). The server hands us all students, their batch enrollments and
 *  a single batched pull of attempts; we group by user_id in memory — never
 *  N+1 per student.
 *
 *  Filters (all combine): quiz (scope each student to one quiz), batch
 *  (course + batch_label, e.g. Safalta Morning/Evening) and a GLOBAL admin
 *  exclude list. The fair "Reliability Score" (confidence-adjusted average) is
 *  the default ranking; class average + n are computed WITHIN the active filter
 *  scope and AFTER excluded users are removed, so staff/test accounts never skew
 *  the baseline or ranks.
 * ============================================================================
 */

/** Stable key for a batch = course + (optional) batch_label snapshot. */
const BATCH_SEP = "\u0001";
export function leaderboardBatchKey(courseId: string, batchLabel: string | null | undefined): string {
  const bl = (batchLabel || "").trim();
  return bl ? `${courseId}${BATCH_SEP}${bl}` : courseId;
}

export interface BatchOption {
  key: string;              // opaque value for the filter dropdown
  courseId: string;
  batchLabel: string | null; // null ⇒ course-level (enrollment had no batch_label)
  title: string;            // "Course — Batch" (or just course title)
  studentCount: number;
}

export interface SubjectTag {
  label: string;
  accuracy: number;
}

export interface LeaderboardRow {
  studentId: string;
  name: string;
  phone: string | null;
  batchLabel: string | null;
  batches: string[];
  hasData: boolean;
  quizzes: number;       // distinct quizzes attempted (within scope)
  attempts: number;      // finished attempts (within scope)
  accuracy: number;      // raw accuracy % (within scope)
  attemptRate: number;   // attempted / faced (within scope)
  reliability: number;   // confidence-adjusted accuracy % (1dp) — default ranking
  topSubject: SubjectTag | null;
  weakSubject: SubjectTag | null;
}

/**
 * Premium analytics for the CURRENT filter scope (respecting exclude-users +
 * qualified set). Computed on-read from the same batched attempt pull, so it
 * serves historical AND future attempts identically — every qualifying attempt
 * counts regardless of when it was taken. All numbers are simple: %, counts and
 * bands/buckets (no stats jargon leaks to the UI).
 */
export interface LeaderboardAnalytics {
  // (a) Batch average — per-student accuracy across the qualified cohort.
  cohortAccuracyAvg: number;      // = classAverage
  accuracyBands: number[];        // 5 bands [0-20,20-40,40-60,60-80,80-100] → student counts
  // (b) Quiz average — per-attempt score % across qualifying attempts in scope.
  attemptAccuracyAvg: number;
  attemptAccuracyBands: number[]; // 5 bands → attempt counts
  totalAttempts: number;          // qualifying completed attempts in scope
  // (c) Avg time taken — from time_taken_seconds (or derived from timestamps).
  timeTracked: boolean;           // false when no attempt in scope has usable time
  timeTrackedAttempts: number;
  avgTimeSeconds: number;
  timeBuckets: number[];          // 5 buckets [<5m,5-10m,10-20m,20-30m,30m+] → attempt counts
  // (d) Participation — attempted vs enrolled in scope.
  enrolledCount: number;          // roster in scope (excluded users already removed)
  attemptedCount: number;         // qualified participants (= studentCount)
  participationPct: number;
  // (e) Top score — best single-attempt score % in scope + who.
  topScore: { studentId: string; name: string; accuracy: number } | null;
}

export interface LeaderboardResult {
  batchLabel: string;        // "All batches" or the selected batch title
  batchKey: string | null;   // null for All batches
  quizId: string | null;     // null for All quizzes
  snapshotISO: string;
  studentCount: number;      // qualified participants shown (= paidCount + nonPayingCount)
  paidCount: number;         // qualified participants who have paid (see isPayingStudent)
  nonPayingCount: number;    // qualified participants with no payment (leads / free regs)
  classAverage: number;      // mean raw accuracy of the qualified cohort (0 if none)
  reliabilityC: number;      // confidence constant actually used
  excludedCount: number;     // excluded students that fall within the active scope
  analytics: LeaderboardAnalytics;
  batches: BatchOption[];
  rows: LeaderboardRow[];
}

/** 0–100% → band index 0..4 (80–100 includes 100). */
function bandIndex(pct: number): number {
  return Math.min(4, Math.max(0, Math.floor(pct / 20)));
}

/** Time bucket index: <5m, 5–10m, 10–20m, 20–30m, 30m+. */
function timeBucketIndex(sec: number): number {
  if (sec < 300) return 0;
  if (sec < 600) return 1;
  if (sec < 1200) return 2;
  if (sec < 1800) return 3;
  return 4;
}

/**
 * Usable duration for an attempt, in whole seconds, or null when untracked.
 * Prefers the stored `time_taken_seconds`; falls back to submitted_at − started_at
 * (read-time compat for any older attempt that never persisted the column). Never
 * fabricated — returns null when neither source is usable.
 */
export function attemptDurationSeconds(a: QuizAttempt): number | null {
  if (typeof a.time_taken_seconds === "number" && a.time_taken_seconds > 0) return Math.round(a.time_taken_seconds);
  const s = a.started_at ? Date.parse(a.started_at) : NaN;
  const e = a.submitted_at ? Date.parse(a.submitted_at) : NaN;
  if (Number.isFinite(s) && Number.isFinite(e) && e > s) return Math.round((e - s) / 1000);
  return null;
}

const norm = (p: string | null | undefined) => (p || "").trim();

/**
 * A student qualifies for the leaderboard only via a COMPLETED quiz attempt —
 * i.e. one they actually submitted (manually or auto-submitted on time-up), NOT
 * merely started (IN_PROGRESS) or abandoned/expired. `submitted_at` is the
 * reliable marker (present for SUBMITTED / AUTO_SUBMITTED, null while in
 * progress); we also gate on the explicit statuses for robustness against any
 * future status that might carry a stray timestamp. Scoped to the leaderboard
 * read path — the quiz-taking flow and per-student dashboards are untouched.
 */
const COMPLETED_ATTEMPT_STATUSES: ReadonlySet<string> = new Set(["SUBMITTED", "AUTO_SUBMITTED"]);
export function isCompletedAttempt(a: QuizAttempt): boolean {
  return COMPLETED_ATTEMPT_STATUSES.has(a.status) && !!a.submitted_at;
}

/**
 * Source of truth for "paid": real money received, mirroring the app's own
 * access gate (paidCourseIdsForPhone) + the LMS-subscription signal.
 *   • LMS subscriber  → students.plan != null (plan tiers are all paid; expired
 *     plans still count — they DID pay, expiry only affects access, not billing).
 *   • Paid course     → any course_enrollment for the phone with
 *     (amount_paid > 0 OR status = 'fully_paid') AND status != 'cancelled'
 *     (matches paidCourseIdsForPhone: covers seats/EMI/full + ₹0 comps, drops
 *     cancelled/refunded).
 * Everything else is non-paying (quiz/marketing leads, free-webinar-only regs).
 */
function buildPaidPhoneSet(enrollments: CourseEnrollment[]): Set<string> {
  const paid = new Set<string>();
  for (const e of enrollments) {
    if ((e.amount_paid > 0 || e.status === "fully_paid") && e.status !== "cancelled") {
      const p = norm(e.phone);
      if (p) paid.add(p);
    }
  }
  return paid;
}

function isPayingStudent(s: Student, paidPhones: Set<string>): boolean {
  return s.plan != null || paidPhones.has(norm(s.phone));
}

/** Strongest / weakest subject among buckets the student actually attempted. */
function edges(subjects: MasteryRow[]): { top: SubjectTag | null; weak: SubjectTag | null } {
  const attempted = subjects.filter((s) => s.attempted > 0);
  if (attempted.length === 0) return { top: null, weak: null };
  // buildOverallPerformance returns subjects weakest-first.
  const weak = attempted[0];
  const top = attempted[attempted.length - 1];
  return {
    top: { label: top.label, accuracy: top.accuracy },
    weak: { label: weak.label, accuracy: weak.accuracy },
  };
}

export function buildLeaderboard(opts: {
  students: Student[];
  enrollments: CourseEnrollment[];
  attempts: QuizAttempt[];
  quizById: Map<string, QuizMeta>;
  /** Batch filter — value comes from BatchOption.key (course + batch_label). */
  batchKey?: string | null;
  /** Quiz filter — scope every student's stats to this single quiz. */
  quizId?: string | null;
  /** GLOBAL admin-managed excluded student ids (merged with built-in staff). */
  excludedStudentIds?: Iterable<string>;
  /** Confidence constant C for the Reliability Score (defaults to 3). */
  reliabilityC?: number;
  now?: number;
}): LeaderboardResult {
  const {
    students: allStudents, enrollments, attempts, quizById,
    batchKey = null, quizId = null,
    excludedStudentIds, reliabilityC = LEADERBOARD_DEFAULT_C, now = Date.now(),
  } = opts;

  // Effective exclusions = built-in staff/test ids ∪ admin-managed global list.
  // This is the SINGLE source of truth applied to ranking AND every aggregate.
  const excluded = new Set<string>(LEADERBOARD_EXCLUDED_STUDENT_IDS);
  if (excludedStudentIds) for (const id of excludedStudentIds) if (id) excluded.add(id);

  // Drop excluded accounts BEFORE any counting/ranking, so batch counts, the
  // paid/non-paying split, cohort size, class average and ranks all reflect real
  // students only (ranks derive from row position → no gaps/off-by-one). Purely a
  // view filter; the accounts themselves are untouched everywhere else.
  const students = allStudents.filter((s) => !excluded.has(s.id));

  // phone → (batchKey → batch descriptor). A student can be in multiple batches.
  const batchesByPhone = new Map<string, Map<string, { courseId: string; batchLabel: string | null; title: string }>>();
  for (const e of enrollments) {
    const phone = norm(e.phone);
    if (!phone || !e.course_id) continue;
    const bl = norm(e.batch_label) || null;
    const key = leaderboardBatchKey(e.course_id, bl);
    const courseTitle = e.course_title || e.batch_label || "Course";
    const title = bl ? `${courseTitle} — ${bl}` : courseTitle;
    const m = batchesByPhone.get(phone) || new Map<string, { courseId: string; batchLabel: string | null; title: string }>();
    if (!m.has(key)) m.set(key, { courseId: e.course_id, batchLabel: bl, title });
    batchesByPhone.set(phone, m);
  }

  // Batch filter options — distinct (course, batch_label) with a student count.
  const batchCounts = new Map<string, { courseId: string; batchLabel: string | null; title: string; students: Set<string> }>();
  for (const s of students) {
    const m = batchesByPhone.get(norm(s.phone));
    if (!m) continue;
    for (const [key, d] of m) {
      const cur = batchCounts.get(key) || { courseId: d.courseId, batchLabel: d.batchLabel, title: d.title, students: new Set<string>() };
      cur.students.add(s.id);
      batchCounts.set(key, cur);
    }
  }
  const batches: BatchOption[] = [...batchCounts.entries()]
    .map(([key, v]) => ({ key, courseId: v.courseId, batchLabel: v.batchLabel, title: v.title, studentCount: v.students.size }))
    .sort((a, b) => a.title.localeCompare(b.title));

  // Roster for the active batch view.
  const roster = students.filter((s) => {
    if (!batchKey) return true; // All batches
    const m = batchesByPhone.get(norm(s.phone));
    return !!m && m.has(batchKey);
  });

  const paidPhones = buildPaidPhoneSet(enrollments);

  // Group the single batched attempt pull by user_id; scope to the quiz filter
  // AND to COMPLETED (submitted) attempts only — so a merely-started attempt
  // never qualifies anyone. Still one in-memory pass over the single batched
  // pull (no N+1, no extra query).
  const attemptsByUser = new Map<string, QuizAttempt[]>();
  for (const a of attempts) {
    if (!a.user_id) continue;
    if (quizId && a.quiz_id !== quizId) continue; // Feature 1 — one-quiz scope
    if (!isCompletedAttempt(a)) continue;         // n ≥ 1 must mean completed quizzes
    const arr = attemptsByUser.get(a.user_id) || [];
    arr.push(a);
    attemptsByUser.set(a.user_id, arr);
  }

  // Build a row for each roster student, then QUALIFY: keep only students with
  // ≥ 1 completed quiz attempt in the active scope. Zero-attempt students are
  // fully dropped (never a 0 row). Order of operations: scope (quiz/batch) →
  // drop manual exclusions (done above) → drop n = 0 (here) → then class
  // average, Reliability Score and ranks are computed over what remains.
  // Attempt-level analytics accumulators (Features 1b/1c) — filled from the SAME
  // scoped attempts as we qualify students, so historical + future attempts are
  // treated identically and there is no extra pass/query.
  const attemptAccuracyBands = [0, 0, 0, 0, 0];
  const timeBuckets = [0, 0, 0, 0, 0];
  let attemptAccuracySum = 0;
  let totalAttempts = 0;
  let timeSecSum = 0;
  let timeTrackedAttempts = 0;

  const qualified: { row: LeaderboardRow; student: Student }[] = [];
  for (const s of roster) {
    const scopedAttempts = attemptsByUser.get(s.id) || [];
    if (scopedAttempts.length === 0) continue; // n = 0 → not on the leaderboard

    const batchMap = batchesByPhone.get(norm(s.phone));
    const batchTitles = batchMap ? [...batchMap.values()].map((d) => d.title) : [];
    const primaryBatch = batchKey ? batchMap?.get(batchKey)?.title ?? null : batchTitles[0] ?? null;

    const overall = buildOverallPerformance({
      attempts: scopedAttempts,
      quizById,
      answers: [],
      studentName: s.name,
      batchLabel: primaryBatch || "",
      now,
    });

    // Defensive: buildOverallPerformance also drops IN_PROGRESS, so this is only
    // false if a completed attempt carried no scorable data — still not a qualifier.
    if (!overall.hasData || overall.hero.totalQuizzes < 1) continue;

    // Per-attempt analytics for this qualified student (excluded users never reach
    // here, so aggregates stay clean).
    for (const a of scopedAttempts) {
      const attempted = a.correct_count + a.incorrect_count;
      const acc = attempted > 0 ? (a.correct_count / attempted) * 100 : 0;
      attemptAccuracyBands[bandIndex(acc)]++;
      attemptAccuracySum += acc;
      totalAttempts++;
      const dur = attemptDurationSeconds(a);
      if (dur != null) {
        timeBuckets[timeBucketIndex(dur)]++;
        timeSecSum += dur;
        timeTrackedAttempts++;
      }
    }

    const { top, weak } = edges(overall.subjects);
    qualified.push({
      student: s,
      row: {
        studentId: s.id,
        name: s.name,
        phone: s.phone || null,
        batchLabel: primaryBatch,
        batches: batchTitles,
        hasData: true,
        quizzes: overall.hero.totalQuizzes,
        attempts: overall.hero.totalAttempts,
        accuracy: overall.hero.accuracy,
        attemptRate: overall.hero.attemptRate,
        reliability: 0, // filled below once class average is known
        topSubject: top,
        weakSubject: weak,
      },
    });
  }

  const rows: LeaderboardRow[] = qualified.map((q) => q.row);

  // Feature 3 — Reliability Score. classAverage = mean raw accuracy over the
  // QUALIFIED cohort only (every row here has n ≥ 1), so non-participants can't
  // dilute the baseline. Empty cohort ⇒ 0 (reliabilityScore stays divide-by-zero
  // safe since C ≥ 0 and n + C only hits 0 when both are 0).
  const classAverage = rows.length
    ? Math.round((rows.reduce((sum, r) => sum + r.accuracy, 0) / rows.length) * 10) / 10
    : 0;
  for (const r of rows) {
    r.reliability = reliabilityScore(r.quizzes, r.accuracy, classAverage, reliabilityC);
  }

  // Paid vs non-paying over the QUALIFIED participants (so header counts match
  // the list). Always sums to rows.length = studentCount.
  const paidCount = qualified.reduce((n, q) => n + (isPayingStudent(q.student, paidPhones) ? 1 : 0), 0);
  const nonPayingCount = rows.length - paidCount;

  // Default sort over the qualified set → contiguous ranks (no gaps): highest
  // Reliability Score first, tie-break by more quizzes → raw accuracy → name.
  rows.sort((a, b) =>
    b.reliability - a.reliability ||
    b.quizzes - a.quizzes ||
    b.accuracy - a.accuracy ||
    a.name.localeCompare(b.name),
  );

  // Excluded users that fall within the active batch scope (for the indicator).
  let excludedCount = 0;
  for (const s of allStudents) {
    if (!excluded.has(s.id)) continue;
    if (!batchKey) { excludedCount++; continue; }
    const m = batchesByPhone.get(norm(s.phone));
    if (m && m.has(batchKey)) excludedCount++;
  }

  // Student-level accuracy distribution (Feature 1a) + top score (Feature 1e),
  // over the qualified rows. Ties on top score resolve to the first by sort order.
  const accuracyBands = [0, 0, 0, 0, 0];
  let topScore: LeaderboardAnalytics["topScore"] = null;
  for (const r of rows) {
    accuracyBands[bandIndex(r.accuracy)]++;
    if (!topScore || r.accuracy > topScore.accuracy) {
      topScore = { studentId: r.studentId, name: r.name, accuracy: r.accuracy };
    }
  }

  const analytics: LeaderboardAnalytics = {
    cohortAccuracyAvg: classAverage,
    accuracyBands,
    attemptAccuracyAvg: totalAttempts ? Math.round((attemptAccuracySum / totalAttempts) * 10) / 10 : 0,
    attemptAccuracyBands,
    totalAttempts,
    timeTracked: timeTrackedAttempts > 0,
    timeTrackedAttempts,
    avgTimeSeconds: timeTrackedAttempts ? Math.round(timeSecSum / timeTrackedAttempts) : 0,
    timeBuckets,
    enrolledCount: roster.length,
    attemptedCount: rows.length,
    participationPct: roster.length ? Math.round((rows.length / roster.length) * 100) : 0,
    topScore,
  };

  return {
    batchLabel: batchKey ? batchCounts.get(batchKey)?.title ?? "Batch" : "All batches",
    batchKey,
    quizId,
    snapshotISO: new Date(now).toISOString(),
    studentCount: rows.length,
    paidCount,
    nonPayingCount,
    classAverage,
    reliabilityC,
    excludedCount,
    analytics,
    batches,
    rows,
  };
}
