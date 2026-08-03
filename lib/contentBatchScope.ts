/**
 * Batch-scoped content visibility for Class Hub / lectures.
 *
 * Rule: when content_items.batch_ids is non-empty, the learner must have a
 * resolvable enrolled batch_id that intersects that set (union across
 * multi-enrolments). Empty/null batch_ids → fail-open (course-level access).
 * Unresolvable / missing enrolment batch → fail-open + structured warning.
 */
import { resolveEnrollmentBatchId } from "./courseZoom";
import { isActiveEnrollment } from "./installments";
import type { ContentItem, Course, CourseEnrollment } from "./types";

export type BatchScopeDecision =
  | { allow: true; failOpen: false }
  | { allow: true; failOpen: true; reason: "content_unscoped" | "enrolment_batch_ambiguous" | "staff" }
  | { allow: false; failOpen: false; reason: "batch_mismatch" };

export function contentBatchIds(item: Pick<ContentItem, "batch_ids"> | null | undefined): string[] {
  const raw = item?.batch_ids;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return [...new Set(raw.map((x) => String(x || "").trim()).filter(Boolean))];
}

export function recordingCourseIds(rec: Pick<ContentItem, "course_ids" | "course_id">): string[] {
  return rec.course_ids && rec.course_ids.length ? rec.course_ids : rec.course_id ? [rec.course_id] : [];
}

/**
 * Resolvable batch ids for a learner across the given course ids (union).
 * Returns { batchIds, ambiguous } — ambiguous when an active overlapping
 * enrolment has no resolvable batch on a multi-batch course.
 */
export function learnerBatchIdsForCourses(
  enrollments: CourseEnrollment[],
  courses: Course[],
  courseIds: string[],
): { batchIds: string[]; ambiguousEnrollmentIds: string[] } {
  const want = new Set(courseIds);
  const byCourse = new Map(courses.map((c) => [c.id, c]));
  const batchIds = new Set<string>();
  const ambiguousEnrollmentIds: string[] = [];

  for (const e of enrollments) {
    if (!want.has(e.course_id)) continue;
    if (e.status === "cancelled" || e.status === "transferred_out") continue;
    if (!isActiveEnrollment(e) && !(e.amount_paid > 0 || e.status === "fully_paid")) continue;

    const course = byCourse.get(e.course_id);
    if (!course) continue;
    const batches = course.batches || [];
    if (batches.length <= 1) {
      const only = batches[0]?.id || resolveEnrollmentBatchId(course, e);
      if (only) batchIds.add(only);
      continue;
    }
    const resolved = resolveEnrollmentBatchId(course, e);
    if (resolved) batchIds.add(resolved);
    else ambiguousEnrollmentIds.push(e.id);
  }

  return { batchIds: [...batchIds], ambiguousEnrollmentIds };
}

export function decideContentBatchScope(opts: {
  item: Pick<ContentItem, "batch_ids" | "course_ids" | "course_id" | "id" | "visibility">;
  enrollments: CourseEnrollment[];
  courses: Course[];
  /** Staff portal viewers see all content on granted courses. */
  learnerKind?: string | null;
  phone?: string | null;
}): BatchScopeDecision {
  if (opts.item.visibility === "public") return { allow: true, failOpen: false };
  if (opts.learnerKind === "staff") return { allow: true, failOpen: true, reason: "staff" };

  const scoped = contentBatchIds(opts.item);
  if (scoped.length === 0) {
    return { allow: true, failOpen: true, reason: "content_unscoped" };
  }

  const courseIds = recordingCourseIds(opts.item);
  const { batchIds, ambiguousEnrollmentIds } = learnerBatchIdsForCourses(
    opts.enrollments,
    opts.courses,
    courseIds.length ? courseIds : opts.enrollments.map((e) => e.course_id),
  );

  if (ambiguousEnrollmentIds.length > 0 && batchIds.length === 0) {
    logBatchScopeFailOpen({
      reason: "enrolment_batch_ambiguous",
      contentId: opts.item.id,
      phone: opts.phone ?? null,
      enrollmentIds: ambiguousEnrollmentIds,
      contentBatchIds: scoped,
    });
    return { allow: true, failOpen: true, reason: "enrolment_batch_ambiguous" };
  }

  // No resolvable batch at all (e.g. paid but batch_id null on multi-batch course)
  // → fail-open so we never blank a portal.
  if (batchIds.length === 0) {
    logBatchScopeFailOpen({
      reason: "enrolment_batch_ambiguous",
      contentId: opts.item.id,
      phone: opts.phone ?? null,
      enrollmentIds: ambiguousEnrollmentIds,
      contentBatchIds: scoped,
    });
    return { allow: true, failOpen: true, reason: "enrolment_batch_ambiguous" };
  }

  if (scoped.some((b) => batchIds.includes(b))) {
    return { allow: true, failOpen: false };
  }
  return { allow: false, failOpen: false, reason: "batch_mismatch" };
}

export function logBatchScopeFailOpen(payload: {
  reason: string;
  contentId?: string | null;
  phone?: string | null;
  enrollmentIds?: string[];
  contentBatchIds?: string[];
}): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "content_batch_scope_fail_open",
      ...payload,
      ts: new Date().toISOString(),
    }),
  );
}

/** Filter published course content for a learner (Class Hub list). */
export function filterContentByBatchScope(
  items: ContentItem[],
  opts: {
    enrollments: CourseEnrollment[];
    courses: Course[];
    learnerKind?: string | null;
    phone?: string | null;
  },
): ContentItem[] {
  return items.filter((item) => {
    const d = decideContentBatchScope({
      item,
      enrollments: opts.enrollments,
      courses: opts.courses,
      learnerKind: opts.learnerKind,
      phone: opts.phone,
    });
    return d.allow;
  });
}
