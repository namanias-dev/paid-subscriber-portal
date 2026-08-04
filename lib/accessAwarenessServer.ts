/**
 * Server-side loaders for access awareness banners (portal, Class Hub, dashboard API).
 */
import {
  getAllCourses,
  getCourseEnrollmentsByPhone,
  getAccessOverridesByPhone,
} from "./dataProvider";
import { isActiveEnrollment } from "./enrollmentScope";
import {
  accessAwarenessForEnrollment,
  pickPrimaryAccessAwareness,
  type AccessAwarenessBanner,
} from "./accessAwareness";
import type { CourseEnrollment } from "./types";

function activeEnrollments(rows: CourseEnrollment[]): CourseEnrollment[] {
  return rows.filter((e) => isActiveEnrollment(e) && e.status !== "cancelled" && e.status !== "transferred_out");
}

/** All at-risk banners for a phone, optionally scoped to one course. */
export async function listAccessAwarenessForPhone(
  phone: string,
  courseId?: string,
  now = Date.now(),
): Promise<AccessAwarenessBanner[]> {
  const [courses, enrollments, overrides] = await Promise.all([
    getAllCourses(),
    getCourseEnrollmentsByPhone(phone),
    getAccessOverridesByPhone(phone),
  ]);
  const byCourse = new Map(courses.map((c) => [c.id, c]));
  const ovrByCourse = new Map(overrides.map((o) => [o.course_id, o]));

  return activeEnrollments(enrollments)
    .filter((e) => !courseId || e.course_id === courseId)
    .map((e) =>
      accessAwarenessForEnrollment(
        byCourse.get(e.course_id),
        e,
        ovrByCourse.get(e.course_id),
        now,
      ),
    )
    .filter((b): b is AccessAwarenessBanner => !!b);
}

/** Primary (most urgent) banner for portal shell / dashboard. */
export async function getPrimaryAccessAwarenessForPhone(
  phone: string,
  courseId?: string,
  now = Date.now(),
): Promise<AccessAwarenessBanner | null> {
  const banners = await listAccessAwarenessForPhone(phone, courseId, now);
  return pickPrimaryAccessAwareness(banners);
}
