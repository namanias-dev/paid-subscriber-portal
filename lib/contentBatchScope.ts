/**
 * Batch metadata helpers for content_items.batch_ids.
 *
 * Policy (Aug 2026): batch_ids are reporting/scheduling metadata only.
 * Student entitlement is course-scoped — morning/evening/offline/online of the
 * same course all see the same Class Hub content. Do not re-introduce batch
 * gating in canAccessLecture / Class Hub without an explicit product decision.
 */
import type { ContentItem } from "./types";

export function contentBatchIds(item: Pick<ContentItem, "batch_ids"> | null | undefined): string[] {
  const raw = item?.batch_ids;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return [...new Set(raw.map((x) => String(x || "").trim()).filter(Boolean))];
}

export function recordingCourseIds(rec: Pick<ContentItem, "course_ids" | "course_id">): string[] {
  return rec.course_ids && rec.course_ids.length ? rec.course_ids : rec.course_id ? [rec.course_id] : [];
}
