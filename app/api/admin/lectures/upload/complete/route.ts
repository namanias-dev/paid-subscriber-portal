import { NextResponse } from "next/server";
import { requirePermission, requireAnyPermission } from "@/lib/adminGuard";
import { getContentById, updateContent, getWebinarById, updateWebinar } from "@/lib/dataProvider";
import { r2Configured, completeMultipart } from "@/lib/r2";
import type { MultipartPart } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Finalize the multipart upload → R2 assembles the object → mark ready.
 *  Supports lecture (default) and webinar (target="webinar") recordings. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const target = body.target === "webinar" ? "webinar" : "lecture";
  const allowed = target === "webinar"
    ? await requireAnyPermission(["content_courses", "content_webinars"])
    : await requirePermission("content_courses");
  if (!allowed) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Video hosting is not configured." }, { status: 503 });

  const recordingId = String(body.recordingId || "");
  if (!recordingId) return NextResponse.json({ ok: false, error: "recordingId required" }, { status: 400 });

  const parts: MultipartPart[] = Array.isArray(body.parts)
    ? (body.parts as { partNumber: number; etag: string }[])
        .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }))
        .filter((p) => Number.isFinite(p.partNumber) && p.etag)
    : [];
  if (parts.length === 0) return NextResponse.json({ ok: false, error: "parts required" }, { status: 400 });

  if (target === "webinar") {
    const w = await getWebinarById(recordingId);
    if (!w || !w.recording_multipart_key || !w.recording_upload_id) {
      return NextResponse.json({ ok: false, error: "No active upload for this webinar" }, { status: 400 });
    }
    try {
      await completeMultipart(w.recording_multipart_key, w.recording_upload_id, parts);
      await updateWebinar(recordingId, {
        recording_upload_status: "completed",
        recording_key: w.recording_multipart_key,
        recording_upload_id: null,
        recording_file_size: body.fileSize ? Number(body.fileSize) : w.recording_file_size ?? null,
        recording_duration_seconds: body.durationSeconds ? Math.round(Number(body.durationSeconds)) : w.recording_duration_seconds ?? null,
      });
      return NextResponse.json({ ok: true });
    } catch (e) {
      await updateWebinar(recordingId, { recording_upload_status: "failed" }).catch(() => {});
      return NextResponse.json({ ok: false, error: (e as Error).message || "Could not complete upload" }, { status: 500 });
    }
  }

  const rec = await getContentById(recordingId);
  if (!rec || !rec.multipart_key || !rec.multipart_upload_id) {
    return NextResponse.json({ ok: false, error: "No active upload for this recording" }, { status: 400 });
  }
  try {
    await completeMultipart(rec.multipart_key, rec.multipart_upload_id, parts);
    await updateContent(recordingId, {
      upload_status: "completed",
      processed_key: rec.multipart_key,
      multipart_parts: parts,
      file_size: body.fileSize ? Number(body.fileSize) : rec.file_size ?? null,
      duration_seconds: body.durationSeconds ? Math.round(Number(body.durationSeconds)) : rec.duration_seconds ?? null,
      resolution: body.resolution ? String(body.resolution) : rec.resolution ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    await updateContent(recordingId, { upload_status: "failed" }).catch(() => {});
    return NextResponse.json({ ok: false, error: (e as Error).message || "Could not complete upload" }, { status: 500 });
  }
}
