import type { Quiz, SessionPayload, Enrollment } from "./types";

export type AccessReason = "login" | "payment" | "unavailable" | "expired";
export interface AccessResult { ok: boolean; reason?: AccessReason; message?: string }

/** Is the quiz currently live (published + within any schedule window)? */
export function quizIsLive(quiz: Quiz): boolean {
  if (quiz.status !== "published") return false;
  const t = quiz.timing_settings || {};
  const now = Date.now();
  if (t.start_at && now < Date.parse(t.start_at)) return false;
  if (t.end_at && now > Date.parse(t.end_at)) return false;
  const exp = quiz.access_rules?.expires_at;
  if (exp && now > Date.parse(exp)) return false;
  return true;
}

/**
 * Authoritative access check. Caller supplies the verified session and the
 * student's enrollments (empty for guests). Safe fallbacks: if no plan/batch
 * system, course enrollment or a non-free plan grants paid access.
 */
/**
 * @param liveActive when provided, overrides the JWT-snapshot plan check with a
 * DB-fresh signal (false = revoked/expired) so access reflects admin changes
 * immediately rather than after the 7-day token expires.
 */
export function checkQuizAccess(quiz: Quiz, session: SessionPayload | null, enrollments: Enrollment[], liveActive?: boolean): AccessResult {
  if (!quizIsLive(quiz)) return { ok: false, reason: "unavailable", message: "This quiz is not currently available." };

  if (quiz.requires_login && !session) return { ok: false, reason: "login" };

  const allowedCourses = quiz.access_rules?.allowed_course_ids || [];
  const activeCourseIds = enrollments.filter((e) => e.status === "active").map((e) => e.course_id);
  const hasAllowedCourse = allowedCourses.length
    ? allowedCourses.some((c) => activeCourseIds.includes(c))
    : activeCourseIds.length > 0;
  const jwtActive = session ? (session.expiry_date === null || Date.parse(session.expiry_date) > Date.now()) : false;
  const hasPaidPlan = !!session && (liveActive !== undefined ? liveActive : jwtActive);

  if (quiz.requires_payment) {
    if (!session) return { ok: false, reason: "login" };
    if (!hasAllowedCourse && !hasPaidPlan) return { ok: false, reason: "payment", message: "Enroll or upgrade to access this test." };
  } else if (allowedCourses.length) {
    if (!session) return { ok: false, reason: "login" };
    if (!hasAllowedCourse) return { ok: false, reason: "payment", message: "This test is restricted to enrolled students." };
  }

  return { ok: true };
}
