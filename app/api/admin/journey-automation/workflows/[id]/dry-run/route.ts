import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { dryRunWorkflow } from "@/lib/journey-automation/engine/dryRun";
import { writeAudit } from "@/lib/journey-automation/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Produce the DRY-RUN REPORT for a workflow: eligible/excluded/branch counts + the
 * EXACT messages that WOULD send over the REAL current event stream. ZERO sends,
 * ZERO writes (besides an audit row). This is the artifact a human reviews before
 * flipping the workflow live. Requires journey_view.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_view"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const report = await dryRunWorkflow(params.id);
    await writeAudit({
      workflow_id: params.id, version_id: null, action: "dry_run", actor,
      summary: `Dry-run: ${report.eligible} eligible / ${report.wouldSend.length} would-send / 0 sent`,
      after: { eligible: report.eligible, wouldSend: report.wouldSend.length, sends: 0 },
    });
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
