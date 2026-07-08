import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getContentById, updateContent } from "@/lib/dataProvider";
import { r2Configured, signPutUrl, lectureThumbnailKey, lectureNotesKey } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Single-shot presigned PUT for a lecture's thumbnail image or notes PDF (small
 * files — no multipart needed). Persists the resulting key on the record.
 */
export async function POST(req: Request) {
  if (!(await requirePermission("content_courses"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Video hosting is not configured." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const recordingId = String(body.recordingId || "");
  const kind = String(body.kind || "");
  const contentType = String(body.contentType || (kind === "notes" ? "application/pdf" : "image/jpeg"));
  if (!recordingId || (kind !== "thumbnail" && kind !== "notes")) {
    return NextResponse.json({ ok: false, error: "recordingId and valid kind required" }, { status: 400 });
  }

  const rec = await getContentById(recordingId);
  if (!rec) return NextResponse.json({ ok: false, error: "Recording not found" }, { status: 404 });
  const courseId = (rec.course_ids && rec.course_ids[0]) || rec.course_id || "_";
  const key = kind === "notes" ? lectureNotesKey(courseId, recordingId) : lectureThumbnailKey(courseId, recordingId);
  // Capture the asset size (bytes) at upload time so storage analytics stay
  // accurate without a backfill. Optional — omitted sizes fall back to null.
  const size = Number(body.size);
  const sizeVal = Number.isFinite(size) && size > 0 ? Math.round(size) : null;

  try {
    const url = await signPutUrl(key, contentType, 600);
    await updateContent(recordingId, kind === "notes"
      ? { notes_pdf_key: key, notes_pdf_size: sizeVal }
      : { thumbnail_key: key, thumbnail_size: sizeVal });
    return NextResponse.json({ ok: true, url, key });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Could not sign asset" }, { status: 500 });
  }
}
