import { getStudentSession, getBuyerSession } from "./session";
import {
  getStudentById,
  findStudentByPhone,
  getAllCourses,
  getEnrollments,
  getCourseEnrollmentsByPhone,
} from "./dataProvider";
import { studentBlockReason } from "./studentAccess";
import type { Course, Quiz, CaPdf } from "./types";

/**
 * ============================================================================
 *  CENTRAL ENTITLEMENT CHECK — the single source of truth for "does THIS
 *  logged-in person have access to THIS content item?"
 * ----------------------------------------------------------------------------
 *  A "learner" unifies the two identity systems (buyer portal + LMS student)
 *  into one record keyed by phone, with the canonical `students.id` used for
 *  attempt tracking + performance (every paying person now has a student row).
 *
 *  Entitlement is derived from:
 *    learner's active course enrolments  ✕  each course's `entitlements`  ✕  validity
 *  …plus per-quiz `requires_payment` + `access_rules.allowed_course_ids`.
 *
 *  Access is computed from a UNION of both directions so admins can configure
 *  from either side without contradiction:
 *    • course side  → course.entitlements.quiz_ids includes the quiz
 *    • quiz side    → quiz.access_rules.allowed_course_ids includes the course
 * ============================================================================
 */

export interface Learner {
  /** Canonical students.id (attempt ownership + performance). Null only for an edge buyer with no student row yet. */
  studentId: string | null;
  phone: string;
  name: string;
  email: string | null;
  /** Course ids the learner currently has VALID (paid + not expired) access to. */
  courseIds: string[];
  /** Active LMS subscription (plan != null, not expired/revoked). Course-only customers: false. */
  hasPlan: boolean;
  /** LMS subscription blocked (revoked/expired). Course-only customers: false. */
  blocked: boolean;
  kind: "buyer" | "student";
}

const DAY_MS = 86_400_000;

/** Is this course's access still valid for an enrolment made at `enrolledAt`? */
function courseAccessValid(course: Course | undefined, enrolledAt: string): boolean {
  const ent = course?.entitlements;
  if (!ent || ent.access_type !== "limited" || !ent.access_days) return true;
  const expiresAt = new Date(enrolledAt).getTime() + ent.access_days * DAY_MS;
  return Date.now() <= expiresAt;
}

/**
 * Course ids a phone currently has VALID access to: phone-keyed paid
 * course_enrollments (seat/EMI/full) + legacy student enrolments, filtered by
 * each course's limited-access validity.
 */
export async function learnerCourseIds(phone: string, studentId?: string | null): Promise<string[]> {
  const [enrollments, courses] = await Promise.all([
    getCourseEnrollmentsByPhone(phone),
    getAllCourses(),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const ids = new Set<string>();

  for (const e of enrollments) {
    if (e.status === "cancelled") continue;
    if (!(e.amount_paid > 0 || e.status === "fully_paid")) continue;
    if (!courseAccessValid(byId.get(e.course_id), e.created_at)) continue;
    ids.add(e.course_id);
  }

  if (studentId) {
    const legacy = await getEnrollments(studentId);
    for (const e of legacy) if (e.status === "active") ids.add(e.course_id);
  }

  return [...ids];
}

/**
 * Resolve the current logged-in learner across BOTH identity systems. Buyers
 * (course purchasers) are preferred; falls back to an LMS student session.
 * Read-only — never writes. Returns null when logged out.
 */
export async function resolveLearner(): Promise<Learner | null> {
  const buyer = await getBuyerSession();
  if (buyer?.phone) {
    const student = await findStudentByPhone(buyer.phone);
    const courseIds = await learnerCourseIds(buyer.phone, student?.id);
    const blocked = student ? !!studentBlockReason(student) : false;
    return {
      studentId: student?.id ?? null,
      phone: buyer.phone,
      name: buyer.name || student?.name || "Student",
      email: student?.email ?? null,
      courseIds,
      hasPlan: !!student?.plan && !blocked,
      blocked,
      kind: "buyer",
    };
  }

  const ss = await getStudentSession();
  if (ss?.student_id) {
    const student = await getStudentById(ss.student_id);
    if (!student) return null;
    const courseIds = await learnerCourseIds(student.phone, student.id);
    const blocked = !!studentBlockReason(student);
    return {
      studentId: student.id,
      phone: student.phone,
      name: student.name,
      email: student.email ?? null,
      courseIds,
      hasPlan: !!student.plan && !blocked,
      blocked,
      kind: "student",
    };
  }

  return null;
}

// ----------------------------- QUIZZES --------------------------------------

/** Courses that unlock a quiz — union of the quiz's own rules + course-side grants. */
export function quizUnlockCourseIds(quiz: Pick<Quiz, "id" | "access_rules">, courses: Course[]): string[] {
  const fromQuiz = quiz.access_rules?.allowed_course_ids || [];
  const fromCourses = courses.filter((c) => (c.entitlements?.quiz_ids || []).includes(quiz.id)).map((c) => c.id);
  return [...new Set([...fromQuiz, ...fromCourses])];
}

/** A quiz is "paid"/restricted when it requires payment OR any course gates it. */
export function quizIsPaid(quiz: Pick<Quiz, "id" | "requires_payment" | "access_rules">, courses: Course[]): boolean {
  return !!quiz.requires_payment || quizUnlockCourseIds(quiz, courses).length > 0;
}

export type QuizGateReason = "ok" | "login" | "expired" | "payment";

export interface QuizGate {
  /** Free quiz anyone can take (logged-out → lead form; logged-in → seamless). */
  free: boolean;
  /** Whether the current learner may take it right now. */
  allowed: boolean;
  reason: QuizGateReason;
  /** Courses that would unlock it (for the upsell), when locked. */
  unlockCourseIds: string[];
}

/**
 * THE quiz entitlement decision. `requiresLogin` honours the per-quiz flag for
 * free quizzes. For paid quizzes, only entitled learners pass.
 */
export function gateQuiz(
  quiz: Pick<Quiz, "id" | "requires_login" | "requires_payment" | "access_rules">,
  learner: Learner | null,
  courses: Course[],
): QuizGate {
  const unlockCourseIds = quizUnlockCourseIds(quiz, courses);
  const paid = !!quiz.requires_payment || unlockCourseIds.length > 0;

  if (!paid) {
    // Free quiz. Logged-out is allowed (lead form handled elsewhere) unless the
    // quiz explicitly requires login.
    if (quiz.requires_login && !learner) return { free: true, allowed: false, reason: "login", unlockCourseIds };
    return { free: true, allowed: true, reason: "ok", unlockCourseIds };
  }

  if (!learner) return { free: false, allowed: false, reason: "login", unlockCourseIds };

  // Course-restricted paid quiz: a pure course-enrolment check (independent of
  // any LMS subscription expiry — course access stands on its own).
  if (unlockCourseIds.length) {
    const entitled = unlockCourseIds.some((id) => learner.courseIds.includes(id));
    return entitled
      ? { free: false, allowed: true, reason: "ok", unlockCourseIds }
      : { free: false, allowed: false, reason: "payment", unlockCourseIds };
  }

  // Generic paid quiz (no course mapping) — backward compatible: any active LMS
  // subscriber OR any course-paying learner passes.
  if (learner.hasPlan || learner.courseIds.length > 0) return { free: false, allowed: true, reason: "ok", unlockCourseIds };
  return { free: false, allowed: false, reason: learner.blocked ? "expired" : "payment", unlockCourseIds };
}

// --------------------------- OTHER CONTENT ----------------------------------

/** Does the learner's set of courses grant a specific content id via the named entitlement list? */
function grantedByCourses(
  learner: Learner | null,
  courses: Course[],
  pick: (e: NonNullable<Course["entitlements"]>) => string[] | undefined,
  contentId: string,
): boolean {
  // `learner.courseIds` is already validity-filtered, so course-granted content
  // stands independently of any LMS subscription expiry.
  if (!learner) return false;
  return courses.some(
    (c) => learner.courseIds.includes(c.id) && (pick(c.entitlements || {}) || []).includes(contentId),
  );
}

/** Is a library/study-material doc unlocked by the learner's enrolments? */
export function isLibraryDocEntitled(docId: string, learner: Learner | null, courses: Course[]): boolean {
  return grantedByCourses(learner, courses, (e) => e.library_doc_ids, docId);
}

/**
 * Current-affairs PDF entitlement. A logged-in learner enrolled in a course that
 * lists this compilation (or that unlocks all free compilations) gets it; else
 * the existing free/login/lead rules apply.
 */
export function isCaPdfEntitled(pdf: Pick<CaPdf, "id" | "is_free">, learner: Learner | null, courses: Course[]): boolean {
  if (!learner) return false;
  if (pdf.is_free && courses.some((c) => learner.courseIds.includes(c.id) && c.entitlements?.ca_all_free)) return true;
  return grantedByCourses(learner, courses, (e) => e.ca_pdf_ids, pdf.id);
}
