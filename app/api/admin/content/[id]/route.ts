import { NextResponse } from "next/server";
import { getContentById, updateContent, deleteContent } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";
import {
  r2Configured,
  deleteObject,
  abortMultipart,
  lectureVideoKey,
  lectureThumbnailKey,
  lectureNotesKey,
} from "@/lib/r2";
import type { ContentItem } from "@/lib/types";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    if (!(await requirePermission("content_courses"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    const fields: (keyof ContentItem)[] = [
      "type",
      "subject",
      "paper",
      "faculty",
      "title",
      "description",
      "drive_link",
      "youtube_link",
      "telegram_link",
      "date",
      "duration",
      "is_published",
      "course_id",
      "course_ids",
      "class_no",
      "drip_date",
      "source_type",
      "visibility",
      "public_cdn",
    ];
    for (const f of fields) {
      if (body[f] !== undefined) {
        patch[f] = body[f];
      }
    }
    // Keep the legacy single course_id in sync with the multi-assignment array.
    if (Array.isArray(patch.course_ids)) {
      patch.course_id = (patch.course_ids as string[])[0] ?? null;
    }
    const updated = await updateContent(params.id, patch as Partial<ContentItem>);
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, content: updated });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to update content." },
      { status: 500 }
    );
  }
}

/**
 * Delete the R2 objects backing a HOSTED recording so deleting it doesn't leave
 * orphaned (billed) files. Link recordings have no objects → no-op. R2 failures
 * (incl. already-deleted NoSuchKey, which deleteObject/abortMultipart swallow)
 * are logged but NEVER block the DB delete, so the admin is never stuck.
 */
async function cleanupHostedR2(rec: ContentItem): Promise<void> {
  if (rec.source_type !== "hosted" || !r2Configured()) return;
  try {
    const courseId = (rec.course_ids && rec.course_ids[0]) || rec.course_id || "";

    // 1) In-progress upload → abort multipart first so partial parts aren't billed.
    if (rec.multipart_upload_id) {
      const mpKey = rec.multipart_key || rec.processed_key || lectureVideoKey(courseId, rec.id);
      await abortMultipart(mpKey, rec.multipart_upload_id);
    }

    // 2) Delete the finished objects (video + optional thumbnail + optional notes).
    //    Include the computed video key as a fallback in case processed_key is unset.
    const keys = new Set<string>(
      [
        rec.processed_key,
        rec.upload_status === "completed" ? lectureVideoKey(courseId, rec.id) : null,
        rec.thumbnail_key,
        rec.notes_pdf_key,
      ].filter((k): k is string => !!k),
    );
    await Promise.all([...keys].map((k) => deleteObject(k)));
  } catch (e) {
    console.error(`[content/delete] R2 cleanup failed for ${rec.id} (DB delete will proceed):`, (e as Error).message);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    if (!(await requirePermission("content_courses"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    // Fetch first so we know the source_type + R2 keys before the row is gone.
    const rec = await getContentById(params.id);
    if (!rec) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    await cleanupHostedR2(rec);
    const ok = await deleteContent(params.id);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to delete content." },
      { status: 500 }
    );
  }
}
