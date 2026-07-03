import type { QuizAttempt, Student, CourseEnrollment } from "./types";
import { buildOverallPerformance, type MasteryRow, type QuizMeta } from "./overallPerformance";
import { LEADERBOARD_EXCLUDED_STUDENT_IDS } from "./leaderboardExclusions";

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
 * ============================================================================
 */

export interface BatchOption {
  courseId: string;
  title: string;
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
  quizzes: number;     // distinct quizzes attempted
  attempts: number;    // finished attempts
  accuracy: number;    // overall accuracy (correct / attempted)
  attemptRate: number; // attempted / faced
  topSubject: SubjectTag | null;
  weakSubject: SubjectTag | null;
}

export interface LeaderboardResult {
  batchLabel: string;        // "All batches" or the selected course title
  courseId: string | null;   // null for All batches
  snapshotISO: string;
  studentCount: number;      // roster total (paidCount + nonPayingCount)
  paidCount: number;         // roster students who have paid (see isPayingStudent)
  nonPayingCount: number;    // roster students with no payment (leads / free regs)
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
  courseId?: string | null;
  now?: number;
}): LeaderboardResult {
  const { students: allStudents, enrollments, attempts, quizById, courseId = null, now = Date.now() } = opts;

  // Feature B — drop excluded staff/internal accounts by stable id BEFORE any
  // counting/ranking, so batch counts, the paid/non-paying split, the roster and
  // ranks all reflect real students only (ranks derive from row position → no
  // gaps/off-by-one). Purely a view filter; the accounts are untouched elsewhere.
  const students = allStudents.filter((s) => !LEADERBOARD_EXCLUDED_STUDENT_IDS.has(s.id));

  // phone → set of {courseId,title} (a student can be in multiple batches).
  const batchesByPhone = new Map<string, Map<string, string>>();
  for (const e of enrollments) {
    const phone = norm(e.phone);
    if (!phone) continue;
    const m = batchesByPhone.get(phone) || new Map<string, string>();
    m.set(e.course_id, e.course_title || e.batch_label || "Course");
    batchesByPhone.set(phone, m);
  }

  // Batch filter options — distinct enrolled courses, with a student count.
  const batchCounts = new Map<string, { title: string; students: Set<string> }>();
  for (const s of students) {
    const m = batchesByPhone.get(norm(s.phone));
    if (!m) continue;
    for (const [cid, title] of m) {
      const cur = batchCounts.get(cid) || { title, students: new Set<string>() };
      cur.students.add(s.id);
      batchCounts.set(cid, cur);
    }
  }
  const batches: BatchOption[] = [...batchCounts.entries()]
    .map(([cid, v]) => ({ courseId: cid, title: v.title, studentCount: v.students.size }))
    .sort((a, b) => a.title.localeCompare(b.title));

  // Roster for the active view.
  const roster = students.filter((s) => {
    if (!courseId) return true; // All batches
    const m = batchesByPhone.get(norm(s.phone));
    return !!m && m.has(courseId);
  });

  // Feature A — paid vs non-paying over the (excluded-free) roster. Two buckets
  // that always sum to roster.length: paid + non-paying = studentCount.
  const paidPhones = buildPaidPhoneSet(enrollments);
  const paidCount = roster.reduce((n, s) => n + (isPayingStudent(s, paidPhones) ? 1 : 0), 0);
  const nonPayingCount = roster.length - paidCount;

  // Group the single batched attempt pull by user_id.
  const attemptsByUser = new Map<string, QuizAttempt[]>();
  for (const a of attempts) {
    if (!a.user_id) continue;
    const arr = attemptsByUser.get(a.user_id) || [];
    arr.push(a);
    attemptsByUser.set(a.user_id, arr);
  }

  const rows: LeaderboardRow[] = roster.map((s) => {
    const batchMap = batchesByPhone.get(norm(s.phone));
    const batchTitles = batchMap ? [...batchMap.values()] : [];
    const primaryBatch = courseId ? batchMap?.get(courseId) ?? null : batchTitles[0] ?? null;

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
      topSubject: top,
      weakSubject: weak,
    };
  });

  // Default sort: has-data first, then highest accuracy (top performers first).
  rows.sort((a, b) => {
    if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
    return b.accuracy - a.accuracy || b.quizzes - a.quizzes || a.name.localeCompare(b.name);
  });

  return {
    batchLabel: courseId ? batchCounts.get(courseId)?.title ?? "Batch" : "All batches",
    courseId,
    snapshotISO: new Date(now).toISOString(),
    studentCount: roster.length,
    paidCount,
    nonPayingCount,
    batches,
    rows,
  };
}
