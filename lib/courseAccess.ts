import type { Enrollment } from "./types";

/**
 * Inputs that can grant access to a course's Class Hub.
 *
 * Phase 1 uses the existing enrollment flag (active enrollment). The shape is
 * intentionally extensible so Phase 2 can plug in payment status (e.g. a list of
 * paid course slugs/ids from `payments`) without touching call sites.
 */
export interface CourseAccessContext {
  enrollments?: Enrollment[];
  /** Phase 2: course ids/slugs the user has paid for (seat booked / captured). */
  paidCourseIds?: string[];
}

/** Whether the user may view the gated Class Hub for a course. */
export function hasCourseAccess(courseId: string, ctx: CourseAccessContext): boolean {
  const activeEnrollment = (ctx.enrollments || []).some(
    (e) => e.course_id === courseId && e.status === "active"
  );
  // Phase 2 will add: || (ctx.paidCourseIds || []).includes(courseId)
  return activeEnrollment || (ctx.paidCourseIds || []).includes(courseId);
}
