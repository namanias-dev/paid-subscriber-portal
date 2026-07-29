/**
 * Resolve an enrollment's batch start date (catalog > label parse > course-level).
 */
import { resolveStart, type ResolvedStart } from "./enrollmentTransfer";
import type { Course, CourseEnrollment } from "./types";

export { BATCH_START_INSTALLMENT_OFFSET_DAYS } from "./installments";

export function resolveEnrollmentBatchStart(
  course: Course | undefined,
  enrollment: Pick<CourseEnrollment, "batch_id" | "batch_label"> | undefined,
): ResolvedStart {
  if (!enrollment) {
    return { iso: null, provenance: "unknown", detail: "No enrollment.", conflict: null };
  }
  const batch = course?.batches?.find((b) => b.id === enrollment.batch_id) ?? null;
  const resolved = resolveStart(batch, enrollment.batch_label ?? null);
  if (resolved.iso) return resolved;
  if (course?.batch_start) {
    return {
      iso: course.batch_start,
      provenance: "catalog",
      detail: "Fell back to course-level batch_start (no batch row / label date).",
      conflict: null,
    };
  }
  return resolved;
}
