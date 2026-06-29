import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin, getActionActor } from "@/lib/adminGuard";
import { getAllContent, logStorageAudit } from "@/lib/dataProvider";
import { r2Configured, listAllObjects, deleteObject } from "@/lib/r2";
import { buildOrphanReport, recordingIdFromKey } from "@/lib/r2Cleanup";

export const dynamic = "force-dynamic";

/**
 * Orphan reconciliation tool for hosted lecture storage.
 *   GET  → DRY-RUN report: R2 objects with no DB row (orphans) + DB rows whose
 *          R2 object is missing (dangling). Read-only.
 *   POST → APPLY (super-admin only, body { confirm:"DELETE" }): delete the
 *          orphans, audited. Never deletes an object that maps to a live record.
 * Scoped to recording prefixes only (payment proofs are untouched).
 */

async function scan() {
  const [objects, content] = await Promise.all([listAllObjects(), getAllContent()]);
  const validIds = new Set(content.map((c) => c.id));
  const report = buildOrphanReport(objects, validIds);

  // Dangling: a hosted recording whose stored processed_key has no R2 object.
  const objectKeys = new Set(objects.map((o) => o.key));
  const dangling = content
    .filter((c) => c.source_type === "hosted" && c.upload_status === "completed" && c.processed_key && !objectKeys.has(c.processed_key))
    .map((c) => ({ id: c.id, title: c.title, processed_key: c.processed_key }));

  return { report, dangling };
}

export async function GET() {
  if (!(await requirePermission("content_courses"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Video hosting is not configured." }, { status: 503 });

  const { report, dangling } = await scan();
  return NextResponse.json({
    ok: true,
    mode: "dry-run",
    orphans: report.orphans,
    orphanCount: report.orphans.length,
    reclaimableBytes: report.reclaimableBytes,
    reclaimableMB: Math.round((report.reclaimableBytes / 1024 / 1024) * 10) / 10,
    totalRecordingObjects: report.totalRecordingObjects,
    dangling,
    scannedAt: report.scannedAt,
  });
}

export async function POST(req: Request) {
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Super-admin required to reclaim storage." }, { status: 403 });
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Video hosting is not configured." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "DELETE") {
    return NextResponse.json({ ok: false, error: 'Pass { "confirm": "DELETE" } to reclaim orphans.' }, { status: 400 });
  }

  // Re-scan server-side (never trust a client-supplied delete list).
  const { report } = await scan();
  const actor = await getActionActor();
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const o of report.orphans) {
    (await deleteObject(o.key)) ? deleted.push(o.key) : failed.push(o.key);
  }
  await logStorageAudit([
    ...deleted.map((k) => ({ action: "orphan_reclaim" as const, r2_key: k, recording_id: recordingIdFromKey(k), status: "deleted" as const, actor: actor?.id })),
    ...failed.map((k) => ({ action: "orphan_reclaim" as const, r2_key: k, recording_id: recordingIdFromKey(k), status: "failed" as const, actor: actor?.id })),
  ]);

  return NextResponse.json({ ok: true, mode: "apply", deleted, failed, reclaimableBytes: report.reclaimableBytes });
}
