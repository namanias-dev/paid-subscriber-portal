import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { getContentById } from "@/lib/dataProvider";
import { r2Configured, listUploadedParts } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * RESUME source of truth: which parts R2 already has for this upload. The client
 * uploads only the MISSING chunks — no restart from zero after a crash/network drop.
 */
export async function GET(req: Request) {
  if (!(await getAdminSession())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Video hosting is not configured." }, { status: 503 });

  const recordingId = new URL(req.url).searchParams.get("recordingId") || "";
  if (!recordingId) return NextResponse.json({ ok: false, error: "recordingId required" }, { status: 400 });

  const rec = await getContentById(recordingId);
  if (!rec || !rec.multipart_key || !rec.multipart_upload_id) {
    return NextResponse.json({ ok: true, uploadId: null, key: null, parts: [] });
  }
  try {
    const parts = await listUploadedParts(rec.multipart_key, rec.multipart_upload_id);
    return NextResponse.json({ ok: true, uploadId: rec.multipart_upload_id, key: rec.multipart_key, parts });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Could not list parts" }, { status: 500 });
  }
}
