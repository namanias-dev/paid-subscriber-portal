import { getStudentSession, getBuyerSession, getAdminSession } from "./session";
import {
  getStudentById,
  findStudentByPhone,
  getAllCourses,
  getEnrollments,
  getCourseEnrollmentsByPhone,
  getAccessOverridesByPhone,
  getActiveStaffCourseIds,
} from "./dataProvider";
import { studentBlockReason } from "./studentAccess";
import type { Course, Quiz, CaPdf, ContentItem, CourseEnrollment, CourseAccessOverride } from "./types";

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
  kind: "buyer" | "student" | "staff";
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

  // Staff comp access: a logged-in staff member (admin session) views granted
  // courses through the SAME student experience. Pure internal access — no
  // payment/enrolment rows, so it never affects revenue/seat/registration counts.
  const admin = await getAdminSession();
  if (admin?.admin_id) {
    const courseIds = await getActiveStaffCourseIds(admin.admin_id);
    return {
      studentId: null,
      phone: `staff:${admin.admin_id}`,
      name: admin.username || "Staff",
      email: null,
      courseIds,
      hasPlan: false,
      blocked: false,
      kind: "staff",
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

// ----------------------------- HOSTED LECTURES ------------------------------

const GRACE_DAYS = 15; // grace after an installment's due date before access is blocked
const EXPIRING_SOON_DAYS = 7; // chip turns to a gentle countdown within this window

export type LectureAccessReason =
  | "public" | "ok" | "login" | "lifetime" | "active" | "grace"
  | "expired" | "overdue" | "revoked" | "not_enrolled";
export type LectureAccessStatus = "public" | "active" | "expiring" | "grace" | "blocked" | "login";

export interface LectureAccess {
  allowed: boolean;
  reason: LectureAccessReason;
  status: LectureAccessStatus;
  expiresAt?: string | null;
  graceEndsAt?: string | null;
  daysLeft?: number | null;
  /** Pending amount (₹) when access is at-risk/blocked by an installment — for chips + admin. */
  amountDue?: number | null;
}

const daysBetween = (future: number, now: number) => Math.ceil((future - now) / DAY_MS);

function recordingCourseIds(rec: Pick<ContentItem, "course_ids" | "course_id">): string[] {
  return rec.course_ids && rec.course_ids.length ? rec.course_ids : rec.course_id ? [rec.course_id] : [];
}

/** Earliest unpaid installment that has a due date — the binding constraint for EMI/seat access. */
function earliestUnpaidDue(enrollment: CourseEnrollment): { due: number; amount: number } | null {
  const items = (enrollment.schedule || [])
    .filter((i) => !i.paid && i.due)
    .map((i) => ({ due: Date.parse(i.due as string) || 0, amount: i.amount }))
    .filter((i) => i.due > 0)
    .sort((a, b) => a.due - b.due);
  return items[0] ?? null;
}

/**
 * Per-course lecture access decision (pure). Reuses full-payment expiry from the
 * course's own entitlements and the installment schedule for EMI/seat grace.
 * Admin override (grant/revoke) always wins.
 */
export function lectureAccessForCourse(
  course: Course | undefined,
  enrollment: CourseEnrollment | undefined,
  override: CourseAccessOverride | undefined,
  hasLegacyAccess: boolean,
  now: number,
): LectureAccess {
  // 1) Admin manual override wins.
  if (override) {
    if (override.mode === "revoke") return { allowed: false, reason: "revoked", status: "blocked" };
    const exp = override.expires_at ? Date.parse(override.expires_at) || 0 : 0;
    if (!exp) return { allowed: true, reason: "lifetime", status: "active", expiresAt: null };
    if (now <= exp) {
      const daysLeft = daysBetween(exp, now);
      return { allowed: true, reason: "active", status: daysLeft <= EXPIRING_SOON_DAYS ? "expiring" : "active", expiresAt: override.expires_at, daysLeft };
    }
    return { allowed: false, reason: "expired", status: "blocked", expiresAt: override.expires_at };
  }

  // 2) No enrollment row: legacy LMS student enrolment grants active access; else not enrolled.
  if (!enrollment) {
    return hasLegacyAccess
      ? { allowed: true, reason: "active", status: "active" }
      : { allowed: false, reason: "not_enrolled", status: "blocked" };
  }
  if (enrollment.status === "cancelled") return { allowed: false, reason: "not_enrolled", status: "blocked" };

  // 3) Fully paid → full-payment access window from the course's own entitlements.
  if (enrollment.status === "fully_paid") {
    const ent = course?.entitlements;
    if (!ent || ent.access_type !== "limited" || !ent.access_days) {
      return { allowed: true, reason: "lifetime", status: "active", expiresAt: null };
    }
    const exp = (Date.parse(enrollment.created_at) || now) + ent.access_days * DAY_MS;
    if (now > exp) return { allowed: false, reason: "expired", status: "blocked", expiresAt: new Date(exp).toISOString() };
    const daysLeft = daysBetween(exp, now);
    return { allowed: true, reason: "active", status: daysLeft <= EXPIRING_SOON_DAYS ? "expiring" : "active", expiresAt: new Date(exp).toISOString(), daysLeft };
  }

  // 4) Seat-booked / partial / pending → tied to the installment schedule + 15-day grace.
  const unpaid = earliestUnpaidDue(enrollment);
  if (!unpaid) {
    // No dated unpaid installment yet (e.g. only the due-today seat item) → active.
    return { allowed: true, reason: "active", status: "active" };
  }
  const graceEnds = unpaid.due + GRACE_DAYS * DAY_MS;
  if (now <= graceEnds) {
    const overdue = now > unpaid.due;
    return {
      allowed: true,
      reason: overdue ? "grace" : "active",
      status: overdue ? "grace" : "active",
      graceEndsAt: new Date(graceEnds).toISOString(),
      daysLeft: daysBetween(graceEnds, now),
      amountDue: unpaid.amount,
    };
  }
  return {
    allowed: false,
    reason: "overdue",
    status: "blocked",
    graceEndsAt: new Date(graceEnds).toISOString(),
    amountDue: unpaid.amount,
  };
}

/** Rank access results so the aggregate picks the most generous "allowed" outcome. */
function accessRank(a: LectureAccess): number {
  if (!a.allowed) return -1;
  if (a.reason === "lifetime") return 100;
  if (a.status === "active") return 80;
  if (a.status === "expiring") return 60;
  if (a.status === "grace") return 40;
  return 50;
}

/**
 * THE hosted-lecture access decision. Public lectures bypass everything (even
 * logged-out). Otherwise the learner must pass for AT LEAST ONE assigned course;
 * we surface the most generous outcome (and, when blocked, the most actionable).
 */
export function canAccessLecture(
  learner: Learner | null,
  recording: Pick<ContentItem, "course_ids" | "course_id" | "visibility">,
  ctx: { courses: Course[]; enrollments: CourseEnrollment[]; overrides: CourseAccessOverride[]; now?: number },
): LectureAccess {
  const now = ctx.now ?? Date.now();
  if (recording.visibility === "public") return { allowed: true, reason: "public", status: "public" };
  if (!learner) return { allowed: false, reason: "login", status: "login" };

  const courseIds = recordingCourseIds(recording);
  const byCourse = new Map(ctx.courses.map((c) => [c.id, c]));
  const enrByCourse = new Map(ctx.enrollments.filter((e) => e.status !== "cancelled").map((e) => [e.course_id, e]));
  const ovrByCourse = new Map(ctx.overrides.map((o) => [o.course_id, o]));

  // Unassigned hosted recording → treat as general library for any learner with valid access.
  if (courseIds.length === 0) {
    return learner.courseIds.length > 0
      ? { allowed: true, reason: "active", status: "active" }
      : { allowed: false, reason: "not_enrolled", status: "blocked" };
  }

  const results = courseIds.map((cid) =>
    lectureAccessForCourse(byCourse.get(cid), enrByCourse.get(cid), ovrByCourse.get(cid), learner.courseIds.includes(cid), now),
  );
  const allowed = results.filter((r) => r.allowed);
  if (allowed.length) return allowed.sort((a, b) => accessRank(b) - accessRank(a))[0];
  // None allowed → most actionable block (prefer one with an amount due / grace info).
  return results.sort((a, b) => (b.amountDue ?? 0) - (a.amountDue ?? 0))[0] ?? { allowed: false, reason: "not_enrolled", status: "blocked" };
}

/**
 * Async wrapper: resolve the current learner (unless provided) and load the
 * enrolment + override context, then decide. Used by playback + Class Hub.
 */
export async function resolveLectureAccess(
  recording: Pick<ContentItem, "course_ids" | "course_id" | "visibility">,
  preloaded?: { learner?: Learner | null; courses?: Course[] },
): Promise<{ learner: Learner | null; access: LectureAccess }> {
  if (recording.visibility === "public") {
    const learner = preloaded?.learner ?? (await resolveLearner());
    return { learner, access: { allowed: true, reason: "public", status: "public" } };
  }
  const learner = preloaded?.learner ?? (await resolveLearner());
  if (!learner) return { learner: null, access: { allowed: false, reason: "login", status: "login" } };

  const [courses, enrollments, overrides] = await Promise.all([
    preloaded?.courses ? Promise.resolve(preloaded.courses) : getAllCourses(),
    getCourseEnrollmentsByPhone(learner.phone),
    getAccessOverridesByPhone(learner.phone),
  ]);
  return { learner, access: canAccessLecture(learner, recording, { courses, enrollments, overrides }) };
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
