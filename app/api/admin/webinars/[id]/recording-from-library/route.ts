import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { getWebinarById, getContentById, updateWebinar } from "@/lib/dataProvider";
import { deleteObject, r2Configured } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Reuse an already-uploaded hosted video (a course/lecture content_item) as this
 * webinar's recording — by REFERENCE, not by copying the file. We point
 * recording_key at the EXISTING R2 object and mark recording_is_reference=true so
 * the shared object is never deleted when the webinar's recording is removed.
 *
 * Access is unchanged: playback is still gated per-webinar (admin or per-event
 * paid buyer) by /api/webinars/[id]/recording/play. The source course row and
 * its own entitlement-gated playback are untouched.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requireAnyPermission(["content_courses", "content_webinars"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const webinar = await getWebinarById(params.id);
  if (!webinar) return NextResponse.json({ ok: false, error: "Webinar not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const contentId = String(body.contentId || "");
  if (!contentId) return NextResponse.json({ ok: false, error: "contentId required" }, { status: 400 });

  const content = await getContentById(contentId);
  if (!content || content.source_type !== "hosted" || content.upload_status !== "completed" || !content.processed_key) {
    return NextResponse.json({ ok: false, error: "That video isn't a completed hosted recording." }, { status: 400 });
  }

  // Reclaim the webinar's OWN previous object (if any) so switching to a shared
  // reference doesn't orphan storage. Never touch a previously-referenced object.
  if (
    r2Configured() &&
    !webinar.recording_is_reference &&
    webinar.recording_key &&
    webinar.recording_key !== content.processed_key
  ) {
    await deleteObject(webinar.recording_key).catch(() => false);
  }

  const updated = await updateWebinar(params.id, {
    recording_upload_status: "completed",
    recording_key: content.processed_key,
    recording_is_reference: true,
    recording_upload_id: null,
    recording_multipart_key: null,
    recording_file_size: content.file_size ?? null,
    recording_duration_seconds: content.duration_seconds ?? null,
  });

  return NextResponse.json({ ok: true, webinar: updated });
}
