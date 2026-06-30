import { NextResponse } from "next/server";
import { getContentById, updateContent, deleteContent, logStorageAudit, getWebinarById, updateWebinar } from "@/lib/dataProvider";
import { requirePermission, requireAnyPermission, getActionActor } from "@/lib/adminGuard";
import { r2Configured, abortMultipart, deleteObject } from "@/lib/r2";
import { cleanupRecordingR2 } from "@/lib/r2Cleanup";

export const dynamic = "force-dynamic";

/**
 * Cancel an in-progress upload. Either reset the record to idle (keep it) or
 * delete it entirely. When deleting, we run the full R2 cleanup (abort multipart
 * AND delete any already-completed object) so cancelling can never leave an
 * orphaned binary behind. Supports lecture (default) and webinar (target).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const target = body.target === "webinar" ? "webinar" : "lecture";
  const allowed = target === "webinar"
    ? await requireAnyPermission(["content_courses", "content_webinars"])
    : await requirePermission("content_courses");
  if (!allowed) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const recordingId = String(body.recordingId || "");
  if (!recordingId) return NextResponse.json({ ok: false, error: "recordingId required" }, { status: 400 });

  // Webinars never delete the row. Two modes:
  //  - cancel a mid-flight upload (default): abort the multipart, but PRESERVE
  //    any previously-completed recording (recording_key) so a cancelled replace
  //    can't wipe the live recording.
  //  - explicit remove (deleteRecord === true): drop the object + clear fields.
  if (target === "webinar") {
    const w = await getWebinarById(recordingId);
    if (!w) return NextResponse.json({ ok: true });
    if (r2Configured() && w.recording_upload_id && w.recording_multipart_key) {
      await abortMultipart(w.recording_multipart_key, w.recording_upload_id);
    }
    if (body.deleteRecord === true) {
      if (r2Configured() && w.recording_key) await deleteObject(w.recording_key).catch(() => false);
      await updateWebinar(recordingId, {
        recording_upload_status: null,
        recording_upload_id: null,
        recording_multipart_key: null,
        recording_key: null,
        recording_file_size: null,
        recording_duration_seconds: null,
      });
    } else {
      await updateWebinar(recordingId, w.recording_key
        ? { recording_upload_status: "completed", recording_upload_id: null, recording_multipart_key: w.recording_key }
        : { recording_upload_status: null, recording_upload_id: null, recording_multipart_key: null });
    }
    return NextResponse.json({ ok: true });
  }

  const rec = await getContentById(recordingId);
  if (!rec) return NextResponse.json({ ok: true }); // already gone

  if (body.deleteRecord === false) {
    // Keep the row — just abort the multipart and reset it to idle.
    if (r2Configured() && rec.multipart_key && rec.multipart_upload_id) {
      await abortMultipart(rec.multipart_key, rec.multipart_upload_id);
    }
    await updateContent(recordingId, {
      upload_status: "idle",
      multipart_upload_id: null,
      multipart_key: null,
      multipart_parts: [],
      multipart_total_parts: null,
      multipart_chunk_size: null,
    });
    return NextResponse.json({ ok: true });
  }

  // Delete the row, then reclaim every R2 object it owns (no orphan left behind).
  await deleteContent(recordingId);
  const cleanup = await cleanupRecordingR2(rec);
  const actor = await getActionActor();
  await logStorageAudit([
    ...cleanup.deleted.map((k) => ({ action: "abort_cleanup" as const, r2_key: k, recording_id: rec.id, status: "deleted" as const, actor: actor?.id, detail: rec.title })),
    ...cleanup.failed.map((k) => ({ action: "abort_cleanup" as const, r2_key: k, recording_id: rec.id, status: "failed" as const, actor: actor?.id, detail: rec.title })),
  ]);
  return NextResponse.json({ ok: true, storage: { deleted: cleanup.deleted, failed: cleanup.failed } });
}
