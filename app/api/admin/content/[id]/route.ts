import { NextResponse } from "next/server";
import { getContentById, updateContent, deleteContent, logStorageAudit } from "@/lib/dataProvider";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { cleanupRecordingR2 } from "@/lib/r2Cleanup";
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

    // 1) Delete the DB row first (the admin-visible record).
    const ok = await deleteContent(params.id);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    // 2) Cascade to R2: reclaim the binary so storage isn't wasted. Resilient —
    //    failures are logged + audited + surfaced (never silently orphaned). The
    //    DB delete already succeeded, so we never block the admin on R2 hiccups.
    const cleanup = await cleanupRecordingR2(rec);
    const actor = await getActionActor();
    await logStorageAudit([
      ...cleanup.deleted.map((k) => ({ action: "delete_cascade" as const, r2_key: k, recording_id: rec.id, status: "deleted" as const, actor: actor?.id, detail: rec.title })),
      ...cleanup.failed.map((k) => ({ action: "delete_cascade" as const, r2_key: k, recording_id: rec.id, status: "failed" as const, actor: actor?.id, detail: rec.title })),
    ]);
    if (cleanup.failed.length) {
      console.error(`[content/delete] R2 cleanup left ${cleanup.failed.length} object(s) for ${rec.id} — run the orphan tool:`, cleanup.failed);
    }

    return NextResponse.json({
      ok: true,
      storage: { deleted: cleanup.deleted, failed: cleanup.failed },
      ...(cleanup.failed.length
        ? { warning: `Recording deleted, but ${cleanup.failed.length} storage object(s) could not be removed and were logged for cleanup.` }
        : {}),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to delete content." },
      { status: 500 }
    );
  }
}
