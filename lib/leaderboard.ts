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

export interface LeaderboardResult {
  batchLabel: string;        // "All batches" or the selected batch title
  batchKey: string | null;   // null for All batches
  quizId: string | null;     // null for All quizzes
  snapshotISO: string;
  studentCount: number;      // roster total (paidCount + nonPayingCount)
  paidCount: number;         // roster students who have paid (see isPayingStudent)
  nonPayingCount: number;    // roster students with no payment (leads / free regs)
  classAverage: number;      // mean raw accuracy of scoped cohort WITH data (0 if none)
  reliabilityC: number;      // confidence constant actually used
  excludedCount: number;     // excluded students that fall within the active scope
  batches: BatchOption[];
  rows: LeaderboardRow[];
}

const norm = (p: string | null | undefined) => (p || "").trim();

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

  // Paid vs non-paying over the (excluded-free) roster. Always sums to roster.length.
  const paidPhones = buildPaidPhoneSet(enrollments);
  const paidCount = roster.reduce((n, s) => n + (isPayingStudent(s, paidPhones) ? 1 : 0), 0);
  const nonPayingCount = roster.length - paidCount;

  // Group the single batched attempt pull by user_id; scope to the quiz filter.
  const attemptsByUser = new Map<string, QuizAttempt[]>();
  for (const a of attempts) {
    if (!a.user_id) continue;
    if (quizId && a.quiz_id !== quizId) continue; // Feature 1 — one-quiz scope
    const arr = attemptsByUser.get(a.user_id) || [];
    arr.push(a);
    attemptsByUser.set(a.user_id, arr);
  }

  const rows: LeaderboardRow[] = roster.map((s) => {
    const batchMap = batchesByPhone.get(norm(s.phone));
    const batchTitles = batchMap ? [...batchMap.values()].map((d) => d.title) : [];
    const primaryBatch = batchKey ? batchMap?.get(batchKey)?.title ?? null : batchTitles[0] ?? null;

    const overall = buildOverallPerformance({
      attempts: attemptsByUser.get(s.id) || [],
      quizById,
      answers: [],
      studentName: s.name,
      batchLabel: primaryBatch || "",
      now,
    });

    const { top, weak } = edges(overall.subjects);
    return {
      studentId: s.id,
      name: s.name,
      phone: s.phone || null,
      batchLabel: primaryBatch,
      batches: batchTitles,
      hasData: overall.hasData,
      quizzes: overall.hero.totalQuizzes,
      attempts: overall.hero.totalAttempts,
      accuracy: overall.hero.accuracy,
      attemptRate: overall.hero.attemptRate,
      reliability: 0, // filled below once class average is known
      topSubject: top,
      weakSubject: weak,
    };
  });

  // Feature 3 — Reliability Score. classAverage = mean raw accuracy over the
  // scoped cohort members who have data (n>0). Excluded users are already gone,
  // so they never skew this baseline. Guard against an empty cohort (⇒ 0, and
  // reliabilityScore stays divide-by-zero safe since C≥0 and n+C only hits 0
  // when both are 0).
  const withData = rows.filter((r) => r.hasData);
  const classAverage = withData.length
    ? Math.round((withData.reduce((sum, r) => sum + r.accuracy, 0) / withData.length) * 10) / 10
    : 0;
  for (const r of rows) {
    r.reliability = reliabilityScore(r.quizzes, r.accuracy, classAverage, reliabilityC);
  }

  // Default sort: has-data first, then highest Reliability Score (fair ranking),
  // tie-break by more quizzes → raw accuracy → name.
  rows.sort((a, b) => {
    if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
    return (
      b.reliability - a.reliability ||
      b.quizzes - a.quizzes ||
      b.accuracy - a.accuracy ||
      a.name.localeCompare(b.name)
    );
  });

  // Excluded users that fall within the active batch scope (for the indicator).
  let excludedCount = 0;
  for (const s of allStudents) {
    if (!excluded.has(s.id)) continue;
    if (!batchKey) { excludedCount++; continue; }
    const m = batchesByPhone.get(norm(s.phone));
    if (m && m.has(batchKey)) excludedCount++;
  }

  return {
    batchLabel: batchKey ? batchCounts.get(batchKey)?.title ?? "Batch" : "All batches",
    batchKey,
    quizId,
    snapshotISO: new Date(now).toISOString(),
    studentCount: roster.length,
    paidCount,
    nonPayingCount,
    classAverage,
    reliabilityC,
    excludedCount,
    batches,
    rows,
  };
}
