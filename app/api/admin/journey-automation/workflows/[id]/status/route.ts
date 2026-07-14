import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { setWorkflowStatus } from "@/lib/journey-automation/builderStore";
import type { WorkflowStatus } from "@/types/journey-automation";

export const dynamic = "force-dynamic";

const ACTION_TO_STATUS: Record<string, WorkflowStatus> = {
  pause: "paused",
  resume: "active",
  archive: "archived",
  restore: "draft",
};

/**
 * Transition a workflow's lifecycle state (pause / resume / archive). Requires
 * journey_pause. State-machine guarded + audited. Does NOT run anything.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_pause"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const to = ACTION_TO_STATUS[String(body.action)];
  if (!to) return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });

  try {
    await setWorkflowStatus(params.id, to, actor);
    return NextResponse.json({ ok: true, status: to });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
