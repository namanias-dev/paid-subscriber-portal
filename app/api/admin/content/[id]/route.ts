import { NextResponse } from "next/server";
import { getContentById, updateContent, deleteContent } from "@/lib/dataProvider";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { r2Configured, abortMultipart, lectureVideoKey } from "@/lib/r2";
import { enqueuePurge, contentItemKeys } from "@/lib/mediaCascade";
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

    // 1) Delete the DB row first (the admin-visible record) — a failed R2 call
    //    must never leave the admin unable to remove content.
    const ok = await deleteContent(params.id);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const actor = await getActionActor();

    // 2a) Abort any IN-PROGRESS multipart immediately (uncommitted parts — no
    //     reason to keep them through the grace window; they aren't recoverable
    //     content). Completed recordings have no upload id, so this is a no-op.
    if (r2Configured() && rec.source_type === "hosted" && rec.multipart_upload_id) {
      const courseId = (rec.course_ids && rec.course_ids[0]) || rec.course_id || "";
      const mpKey = rec.multipart_key || rec.processed_key || lectureVideoKey(courseId, rec.id);
      await abortMultipart(mpKey, rec.multipart_upload_id);
    }

    // 2b) Cascade every finished object this item owns (video + thumbnail +
    //     notes PDF, or an uploaded/migrated standalone note). Enqueued for a
    //     grace-period purge, reference-checked (never removes a shared object),
    //     scope-guarded and audited. External-link notes resolve to zero keys →
    //     record-only delete, no R2 call.
    const cascade = await enqueuePurge({
      keys: contentItemKeys(rec),
      owner: { type: "content_item", id: rec.id },
      title: rec.title,
      actor: actor?.id,
    });

    return NextResponse.json({
      ok: true,
      storage: {
        scheduled: cascade.scheduled,
        skippedReferenced: cascade.skippedReferenced,
        graceHours: cascade.graceHours,
      },
      ...(cascade.scheduled.length
        ? { note: `Record removed. ${cascade.scheduled.length} file(s) scheduled for deletion in ${cascade.graceHours}h (recoverable until then).` }
        : {}),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to delete content." },
      { status: 500 }
    );
  }
}
