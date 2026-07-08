import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin, getActionActor } from "@/lib/adminGuard";
import { r2Configured } from "@/lib/r2";
import { buildMediaOrphanReport, reclaimOrphans } from "@/lib/mediaCascade";

export const dynamic = "force-dynamic";

/**
 * Global orphan-reconciliation tool across ALL app-deletable R2 prefixes
 * (lecture/webinar videos, thumbnails, note PDFs, current-affairs PDFs).
 *   GET  → DRY-RUN report: objects with no live DB reference and not already
 *          queued for purge. Read-only.
 *   POST → APPLY (super-admin only, body { confirm:"DELETE" }): re-scans
 *          server-side, re-checks references, deletes true orphans, audits each.
 * Reclaims space from files orphaned before the cascade existed. Never touches a
 * referenced object, and never careers/ or payment-proofs/ (out of scope).
 */

export async function GET() {
  if (!(await requirePermission("content_courses"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "File storage is not configured." }, { status: 503 });

  const report = await buildMediaOrphanReport();
  return NextResponse.json({
    ok: true,
    mode: "dry-run",
    orphans: report.orphans,
    orphanCount: report.orphans.length,
    reclaimableBytes: report.reclaimableBytes,
    reclaimableMB: Math.round((report.reclaimableBytes / 1024 / 1024) * 10) / 10,
    scannedObjects: report.scannedObjects,
    scannedAt: report.scannedAt,
  });
}

export async function POST(req: Request) {
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Super-admin required to reclaim storage." }, { status: 403 });
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "File storage is not configured." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "DELETE") {
    return NextResponse.json({ ok: false, error: 'Pass { "confirm": "DELETE" } to reclaim orphans.' }, { status: 400 });
  }

  const actor = await getActionActor();
  const result = await reclaimOrphans(actor?.id);
  return NextResponse.json({
    ok: true,
    mode: "apply",
    deleted: result.deleted,
    deletedCount: result.deleted.length,
    failed: result.failed,
    reclaimedBytes: result.reclaimedBytes,
    reclaimedMB: Math.round((result.reclaimedBytes / 1024 / 1024) * 10) / 10,
  });
}
