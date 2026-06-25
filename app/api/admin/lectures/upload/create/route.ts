import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { getContentById, updateContent } from "@/lib/dataProvider";
import { missingR2EnvVars, createMultipart, lectureVideoKey } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Begin a resumable R2 multipart upload for a hosted lecture. The content_item
 * (metadata) already exists; here we open the multipart upload and persist its
 * id/key + chunking plan so the upload can resume after a crash or refresh.
 */
export async function POST(req: Request) {
  if (!(await getAdminSession())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // Surface the exact misconfiguration instead of a generic 503.
  const missing = missingR2EnvVars();
  if (missing.length) {
    const msg = `Video hosting is not configured — missing env var(s): ${missing.join(", ")}. Set them in .env.local (restart dev) or Vercel (redeploy).`;
    console.error("[lectures/upload/create] " + msg);
    return NextResponse.json({ ok: false, error: msg, missing }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const recordingId = String(body.recordingId || "");
  if (!recordingId) return NextResponse.json({ ok: false, error: "recordingId required" }, { status: 400 });

  const rec = await getContentById(recordingId);
  if (!rec) return NextResponse.json({ ok: false, error: "Recording not found" }, { status: 404 });

  const courseId = (rec.course_ids && rec.course_ids[0]) || rec.course_id || "_";
  const key = lectureVideoKey(courseId, recordingId);

  try {
    const uploadId = await createMultipart(key, "video/mp4");
    await updateContent(recordingId, {
      source_type: "hosted",
      upload_status: "uploading",
      multipart_upload_id: uploadId,
      multipart_key: key,
      multipart_parts: [],
      multipart_total_parts: body.totalParts ? Number(body.totalParts) : null,
      multipart_chunk_size: body.chunkSize ? Number(body.chunkSize) : null,
      file_size: body.fileSize ? Number(body.fileSize) : null,
      duration_seconds: body.durationSeconds ? Math.round(Number(body.durationSeconds)) : null,
      resolution: body.resolution ? String(body.resolution) : null,
    });
    return NextResponse.json({ ok: true, uploadId, key });
  } catch (e) {
    // Surface the REAL R2 error (InvalidAccessKeyId / SignatureDoesNotMatch /
    // ENOTFOUND endpoint / AccessDenied / NoSuchBucket …) in logs + response.
    const err = e as { name?: string; message?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    const code = err.Code || err.name || "UnknownError";
    const detail = `${code}: ${err.message || "Could not start upload"}`;
    console.error("[lectures/upload/create] R2 createMultipart failed →", code, err.message, err.$metadata?.httpStatusCode ?? "");
    return NextResponse.json({ ok: false, error: detail, code }, { status: 502 });
  }
}
