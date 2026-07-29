/**
 * Resolve an enrollment's batch start date.
 * Priority for LIVE access / re-anchor: structured catalog → earliest class → label parse → UNKNOWN.
 * `created_plus_lead` is suggestion-only (admin fill-in) — never invents a start that
 * changes grace/block or re-anchors dues.
 */
import { addDaysISO } from "./dates";
import { resolveStart, type ResolvedStart, type StartProvenance } from "./enrollmentTransfer";
import type { ContentItem, Course, CourseEnrollment } from "./types";

export { BATCH_START_INSTALLMENT_OFFSET_DAYS } from "./installments";

/** Days after course/batch creation used only for admin suggestions. */
export const COURSE_BATCH_LEAD_DAYS = 14;

export type BatchStartExtras = {
  /** Earliest content/timetable date for this course (or batch). */
  earliestClassISO?: string | null;
  /** Course or batch created_at — suggestion only, not live access. */
  createdAtISO?: string | null;
};

/**
 * Live resolver used by entitlements + re-anchor. Never invents a start from
 * created_at+lead — that path is admin suggestion only.
 */
export function resolveEnrollmentBatchStart(
  course: Course | undefined,
  enrollment: Pick<CourseEnrollment, "batch_id" | "batch_label"> | undefined,
  extras?: BatchStartExtras,
): ResolvedStart {
  if (!enrollment) {
    return { iso: null, provenance: "unknown", detail: "No enrollment.", conflict: null };
  }
  const batch = course?.batches?.find((b) => b.id === enrollment.batch_id) ?? null;
  const resolved = resolveStart(batch, enrollment.batch_label ?? null);
  if (resolved.iso && resolved.provenance === "catalog") return resolved;

  if (course?.batch_start) {
    return {
      iso: course.batch_start,
      provenance: "catalog",
      detail: "Fell back to course-level batch_start (no batch row catalog date).",
      conflict: resolved.conflict,
    };
  }

  const classISO = extras?.earliestClassISO ?? null;
  if (classISO && Number.isFinite(Date.parse(classISO))) {
    return {
      iso: classISO,
      provenance: "earliest_class" as StartProvenance,
      detail: `Derived from earliest scheduled class/content date ${classISO}.`,
      conflict: resolved.conflict,
    };
  }

  if (resolved.iso) return resolved; // parsed_label

  return {
    iso: null,
    provenance: "unknown",
    detail: resolved.detail || "Batch start unknown.",
    conflict: null,
  };
}

/** Admin-only suggestion when live resolver returns UNKNOWN. */
export function suggestBatchStartFill(
  course: Course | undefined,
  enrollment: Pick<CourseEnrollment, "batch_id" | "batch_label"> | undefined,
  extras?: BatchStartExtras,
): ResolvedStart {
  const live = resolveEnrollmentBatchStart(course, enrollment, extras);
  if (live.iso) return live;
  const created = extras?.createdAtISO ?? course?.created_at ?? null;
  if (created && Number.isFinite(Date.parse(created))) {
    return {
      iso: addDaysISO(created, COURSE_BATCH_LEAD_DAYS),
      provenance: "created_plus_lead" as StartProvenance,
      detail: `Suggestion only: created_at + ${COURSE_BATCH_LEAD_DAYS}d. Not used for access or re-anchor.`,
      conflict: null,
    };
  }
  return live;
}

/** Earliest content.date among items assigned to this course. */
export function earliestContentDateForCourse(
  items: Pick<ContentItem, "date" | "course_id" | "course_ids">[],
  courseId: string,
): string | null {
  let best: string | null = null;
  let bestMs = Infinity;
  for (const it of items) {
    if (!it.date) continue;
    const ids = it.course_ids?.length ? it.course_ids : it.course_id ? [it.course_id] : [];
    if (!ids.includes(courseId)) continue;
    const ms = Date.parse(it.date);
    if (!Number.isFinite(ms) || ms >= bestMs) continue;
    bestMs = ms;
    best = it.date;
  }
  return best;
}

/** Preview only — derived label from structured start (does not overwrite). */
export function derivedBatchLabelFromStart(
  startISO: string | null,
  mode: string | null | undefined,
  timing: string | null | undefined,
): string | null {
  const parts: string[] = [];
  if (startISO) {
    const d = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric",
    }).format(new Date(startISO));
    parts.push(`Starts ${d}`);
  }
  const mt = [mode, timing].filter(Boolean).join(" · ");
  if (mt) parts.push(mt);
  return parts.length ? parts.join(" · ") : null;
}

/** Re-anchor only when we trust the start (catalog or earliest class — not label parse). */
export function isTrustedBatchStartForReanchor(provenance: string): boolean {
  return provenance === "catalog" || provenance === "earliest_class";
}
