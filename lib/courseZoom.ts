/**
 * Per-batch Zoom / live-class resolution.
 * Order: batch fields → course after_registration fallback → empty.
 * Host/start URLs are admin-only and must never be returned here for students.
 */
import type { Course, CourseBatch, CourseEnrollment } from "./types";

export interface ResolvedLiveClass {
  zoom_link: string | null;
  zoom_meeting_id: string | null;
  zoom_passcode: string | null;
  zoom_note: string | null;
  class_timing: string | null;
  next_class_at: string | null;
  source: "batch" | "course" | "none";
}

function trimOrNull(v: unknown): string | null {
  const s = (v ?? "").toString().trim();
  return s || null;
}

/** Accept zoom.us / zoom.com join URLs (http or https). */
export function isValidZoomUrl(url: string): boolean {
  const s = (url || "").trim();
  if (!s) return true; // empty is allowed (fallback / not set)
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return (
      host === "zoom.us" ||
      host.endsWith(".zoom.us") ||
      host === "zoom.com" ||
      host.endsWith(".zoom.com") ||
      host === "www.zoom.us" ||
      host === "www.zoom.com"
    );
  } catch {
    return false;
  }
}

export function resolveEnrollmentBatchId(
  course: Pick<Course, "batches" | "default_batch_id">,
  enrollment: Pick<CourseEnrollment, "batch_id" | "batch_label"> | null | undefined,
): string | null {
  const batches = course.batches || [];
  if (!batches.length) return null;

  const byId = enrollment?.batch_id?.trim();
  if (byId && batches.some((b) => b.id === byId)) return byId;

  const label = (enrollment?.batch_label || "").toLowerCase();
  if (label) {
    const match = batches.find((b) => {
      const bl = (b.label || "").toLowerCase();
      if (bl && label.includes(bl)) return true;
      const timing = Array.isArray(b.timing) ? b.timing.join(" ") : String(b.timing || "");
      return !!timing && label.includes(timing.toLowerCase());
    });
    if (match) return match.id;
  }

  if (batches.length === 1) return batches[0].id;
  if (course.default_batch_id && batches.some((b) => b.id === course.default_batch_id)) {
    return course.default_batch_id;
  }
  return null;
}

function fromBatch(b: CourseBatch | undefined | null): Partial<ResolvedLiveClass> {
  if (!b) return {};
  return {
    zoom_link: trimOrNull(b.zoom_link),
    zoom_meeting_id: trimOrNull(b.zoom_meeting_id),
    zoom_passcode: trimOrNull(b.zoom_passcode),
    zoom_note: trimOrNull(b.zoom_note),
  };
}

/**
 * Resolve the live-class join details a student should see.
 * Never includes zoom_host_url.
 */
export function resolveLiveClass(
  course: Pick<Course, "batches" | "after_registration" | "default_batch_id">,
  batchId?: string | null,
): ResolvedLiveClass {
  const ar = course.after_registration || {};
  const batch = batchId ? (course.batches || []).find((b) => b.id === batchId) : undefined;
  const b = fromBatch(batch);

  const courseLink = trimOrNull(ar.zoom_link);
  const courseNote = trimOrNull(ar.zoom_note);

  const zoom_link = b.zoom_link || courseLink;
  const zoom_meeting_id = b.zoom_meeting_id || null;
  const zoom_passcode = b.zoom_passcode || null;
  const zoom_note = b.zoom_note || courseNote;
  const class_timing = trimOrNull(ar.class_timing);
  const next_class_at = trimOrNull(ar.next_class_at);

  let source: ResolvedLiveClass["source"] = "none";
  if (b.zoom_link) source = "batch";
  else if (courseLink) source = "course";

  return {
    zoom_link: zoom_link || null,
    zoom_meeting_id,
    zoom_passcode,
    zoom_note: zoom_note || null,
    class_timing,
    next_class_at,
    source,
  };
}

/** Snapshot of Zoom fields used for audit diffs. */
export function zoomAuditSnapshot(batches: CourseBatch[] | undefined | null, afterReg: Course["after_registration"]) {
  return {
    course: {
      zoom_link: trimOrNull(afterReg?.zoom_link),
      zoom_note: trimOrNull(afterReg?.zoom_note),
    },
    batches: (batches || []).map((b) => ({
      id: b.id,
      label: b.label,
      zoom_link: trimOrNull(b.zoom_link),
      zoom_meeting_id: trimOrNull(b.zoom_meeting_id),
      zoom_passcode: trimOrNull(b.zoom_passcode),
      zoom_host_url: trimOrNull(b.zoom_host_url),
      zoom_note: trimOrNull(b.zoom_note),
    })),
  };
}

export function zoomFieldsChanged(
  before: ReturnType<typeof zoomAuditSnapshot>,
  after: ReturnType<typeof zoomAuditSnapshot>,
): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}
