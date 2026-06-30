import { NextResponse } from "next/server";
import { requirePermission, requireAnyPermission } from "@/lib/adminGuard";
import { getContentById, getWebinarById } from "@/lib/dataProvider";
import { r2Configured, listUploadedParts } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * RESUME source of truth: which parts R2 already has for this upload. The client
 * uploads only the MISSING chunks — no restart from zero after a crash/network drop.
 * Works for both lecture and webinar (target="webinar") uploads.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("target") === "webinar" ? "webinar" : "lecture";
  const allowed = target === "webinar"
    ? await requireAnyPermission(["content_courses", "content_webinars"])
    : await requirePermission("content_courses");
  if (!allowed) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Video hosting is not configured." }, { status: 503 });

  const recordingId = url.searchParams.get("recordingId") || "";
  if (!recordingId) return NextResponse.json({ ok: false, error: "recordingId required" }, { status: 400 });

  let key: string | null = null;
  let uploadId: string | null = null;
  if (target === "webinar") {
    const w = await getWebinarById(recordingId);
    key = w?.recording_multipart_key ?? null;
    uploadId = w?.recording_upload_id ?? null;
  } else {
    const rec = await getContentById(recordingId);
    key = rec?.multipart_key ?? null;
    uploadId = rec?.multipart_upload_id ?? null;
  }
  if (!key || !uploadId) {
    return NextResponse.json({ ok: true, uploadId: null, key: null, parts: [] });
  }
  try {
    const parts = await listUploadedParts(key, uploadId);
    return NextResponse.json({ ok: true, uploadId, key, parts });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Could not list parts" }, { status: 500 });
  }
}
