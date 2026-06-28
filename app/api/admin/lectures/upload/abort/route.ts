import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getContentById, updateContent, deleteContent } from "@/lib/dataProvider";
import { r2Configured, abortMultipart } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Cancel an in-progress upload: abort the R2 multipart (R2 discards every part —
 * no orphaned/billed storage), then either delete the pending record entirely
 * (default — nothing left behind) or reset it to idle.
 */
export async function POST(req: Request) {
  if (!(await requirePermission("content_courses"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const recordingId = String(body.recordingId || "");
  if (!recordingId) return NextResponse.json({ ok: false, error: "recordingId required" }, { status: 400 });

  const rec = await getContentById(recordingId);
  if (!rec) return NextResponse.json({ ok: true }); // already gone

  if (r2Configured() && rec.multipart_key && rec.multipart_upload_id) {
    await abortMultipart(rec.multipart_key, rec.multipart_upload_id);
  }

  if (body.deleteRecord === false) {
    await updateContent(recordingId, {
      upload_status: "idle",
      multipart_upload_id: null,
      multipart_key: null,
      multipart_parts: [],
      multipart_total_parts: null,
      multipart_chunk_size: null,
    });
  } else {
    await deleteContent(recordingId);
  }
  return NextResponse.json({ ok: true });
}
