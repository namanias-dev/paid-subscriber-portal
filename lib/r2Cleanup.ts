import {
  r2Configured,
  deleteObject,
  abortMultipart,
  lectureVideoKey,
  lectureThumbnailKey,
  lectureNotesKey,
  type R2Object,
} from "./r2";
import type { ContentItem } from "./types";

/**
 * Shared Cloudflare R2 cleanup + reconciliation for hosted lecture recordings.
 * Used by the content delete route, the upload-abort route, and the orphan tool
 * so deletion logic lives in exactly one place (no drift, no silent orphans).
 */

/** Object-key prefixes that belong to a recording (id is the 3rd path segment). */
export const RECORDING_PREFIXES = ["processed/", "thumbnails/", "notes/"] as const;

/** Extract the recording id from a recording object key, else null. */
export function recordingIdFromKey(key: string): string | null {
  if (!RECORDING_PREFIXES.some((p) => key.startsWith(p))) return null;
  // <prefix>/<courseId>/<recordingId>/<file>
  const parts = key.split("/");
  return parts.length >= 4 ? parts[2] || null : null;
}

/** Every R2 object key a recording could own (stored + canonically computed). */
export function recordingKeys(rec: ContentItem): string[] {
  const courseId = (rec.course_ids && rec.course_ids[0]) || rec.course_id || "";
  const keys = new Set<string>(
    [
      rec.processed_key,
      rec.multipart_key,
      // Fallbacks in case a column was never persisted (failed mid-flight).
      lectureVideoKey(courseId, rec.id),
      rec.thumbnail_key,
      rec.notes_pdf_key,
      lectureThumbnailKey(courseId, rec.id),
      lectureNotesKey(courseId, rec.id),
    ].filter((k): k is string => !!k),
  );
  return [...keys];
}

export interface CleanupResult {
  attempted: string[];
  deleted: string[];
  failed: string[];
}

/**
 * Delete all R2 objects backing a hosted recording (and abort any in-progress
 * multipart so partial parts aren't billed). Link recordings own no objects →
 * no-op. Never throws; returns which keys were deleted vs failed so the caller
 * can audit + surface failures instead of silently leaving orphans.
 */
export async function cleanupRecordingR2(rec: ContentItem): Promise<CleanupResult> {
  const empty: CleanupResult = { attempted: [], deleted: [], failed: [] };
  if (rec.source_type !== "hosted" || !r2Configured()) return empty;

  // 1) Abort an in-progress multipart first (discards uncommitted parts).
  if (rec.multipart_upload_id) {
    const courseId = (rec.course_ids && rec.course_ids[0]) || rec.course_id || "";
    const mpKey = rec.multipart_key || rec.processed_key || lectureVideoKey(courseId, rec.id);
    await abortMultipart(mpKey, rec.multipart_upload_id);
  }

  // 2) Delete every finished object this recording could own.
  const attempted = recordingKeys(rec);
  const deleted: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    attempted.map(async (k) => {
      (await deleteObject(k)) ? deleted.push(k) : failed.push(k);
    }),
  );
  return { attempted, deleted, failed };
}

export interface OrphanReport {
  orphans: R2Object[];
  reclaimableBytes: number;
  totalRecordingObjects: number;
  scannedAt: string;
}

/**
 * Pure reconciliation: recording-prefixed R2 objects whose recording id has no
 * row in the DB are orphans. Objects outside recording prefixes (e.g. payment
 * proofs) are ignored. `validRecordingIds` MUST be the full set of content ids.
 */
export function buildOrphanReport(objects: R2Object[], validRecordingIds: Set<string>): OrphanReport {
  const recObjects = objects.filter((o) => recordingIdFromKey(o.key) !== null);
  const orphans = recObjects.filter((o) => {
    const id = recordingIdFromKey(o.key);
    return id !== null && !validRecordingIds.has(id);
  });
  return {
    orphans,
    reclaimableBytes: orphans.reduce((sum, o) => sum + (o.size || 0), 0),
    totalRecordingObjects: recObjects.length,
    scannedAt: new Date().toISOString(),
  };
}
