/**
 * Course playback / Class Hub content gate — SINGLE SOURCE OF TRUTH.
 *
 * Every surface (pinned access bar, Zoom, lectures, quizzes, notes, downloads,
 * signed URL APIs) MUST read access via `lectureAccessForCourse(..., override)`
 * with the grant applied. Do NOT invent a parallel due-date heuristic — that
 * divergence has already burned this project once.
 */
import {
  getAllCourses,
  getCourseEnrollmentsByPhone,
  getAccessOverridesByPhone,
} from "./dataProvider";
import { lectureAccessForCourse, type LectureAccess } from "./entitlements";
import { isActiveEnrollment } from "./installments";
import type { Course, CourseEnrollment, CourseAccessOverride } from "./types";

export interface CoursePlaybackSnapshot {
  courseId: string;
  enrollment: CourseEnrollment | null;
  override: CourseAccessOverride | undefined;
  /** lectureAccessForCourse result with override applied. */
  access: LectureAccess;
}

export function computeCoursePlaybackAccess(
  course: Course | undefined,
  enrollment: CourseEnrollment | undefined,
  override: CourseAccessOverride | undefined,
  now = Date.now(),
): LectureAccess {
  // SoT — grant/override applied; legacy flag false when we have an enrollment row.
  return lectureAccessForCourse(course, enrollment, override, false, now);
}

export async function getCoursePlaybackAccess(
  phone: string,
  courseId: string,
  now = Date.now(),
): Promise<CoursePlaybackSnapshot | null> {
  const [courses, enrollments, overrides] = await Promise.all([
    getAllCourses(),
    getCourseEnrollmentsByPhone(phone),
    getAccessOverridesByPhone(phone),
  ]);
  const course = courses.find((c) => c.id === courseId);
  const enrollment =
    enrollments.find((e) => e.course_id === courseId && isActiveEnrollment(e)) ||
    enrollments.find((e) => e.course_id === courseId && e.status !== "cancelled") ||
    null;
  if (!enrollment) return null;
  const override = overrides.find((o) => o.course_id === courseId);
  return {
    courseId,
    enrollment,
    override,
    access: computeCoursePlaybackAccess(course, enrollment, override, now),
  };
}

/**
 * True when the learner may open paid content for at least one of `courseIds`
 * (quiz unlock OR). Uses the same SoT as the pinned bar.
 */
export async function learnerHasOpenPlaybackForCourses(
  phone: string,
  courseIds: string[],
  now = Date.now(),
): Promise<boolean> {
  if (!courseIds.length) return true;
  const [courses, enrollments, overrides] = await Promise.all([
    getAllCourses(),
    getCourseEnrollmentsByPhone(phone),
    getAccessOverridesByPhone(phone),
  ]);
  const byCourse = new Map(courses.map((c) => [c.id, c]));
  const ovrBy = new Map(overrides.map((o) => [o.course_id, o]));
  for (const cid of courseIds) {
    const e =
      enrollments.find((x) => x.course_id === cid && isActiveEnrollment(x)) ||
      enrollments.find((x) => x.course_id === cid && x.status !== "cancelled");
    if (!e) continue;
    const access = computeCoursePlaybackAccess(byCourse.get(cid), e, ovrBy.get(cid), now);
    if (access.allowed) return true;
  }
  // No matching enrollment among unlock courses → leave to gateQuiz enrollment logic.
  const anyEnrolled = courseIds.some((cid) =>
    enrollments.some((e) => e.course_id === cid && e.status !== "cancelled"),
  );
  return !anyEnrolled;
}
