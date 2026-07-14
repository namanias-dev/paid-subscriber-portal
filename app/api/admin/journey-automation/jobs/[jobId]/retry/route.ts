import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { retryDeadJob } from "@/lib/journey-automation/engine/monitor";

export const dynamic = "force-dynamic";

/**
 * SAFE manual DLQ retry — re-enqueue a dead/failed job only. Idempotent and
 * guard-respecting: the re-run goes through the full worker path (latest-state
 * revalidation + sendDecision), so it can NEVER bypass compliance or send in
 * simulation. Requires journey_manage_execution. Audited.
 */
export async function POST(_req: Request, { params }: { params: { jobId: string } }) {
  if (!(await requirePermission("journey_manage_execution"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const res = await retryDeadJob(params.jobId, actor);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
