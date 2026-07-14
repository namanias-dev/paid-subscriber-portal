import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { setExecutionMode } from "@/lib/journey-automation/engine/control";
import type { WorkflowExecutionMode } from "@/lib/journey-automation/engine/types";

export const dynamic = "force-dynamic";

const MODES: WorkflowExecutionMode[] = ["off", "simulate", "live"];

/**
 * Set a workflow's execution mode + canary caps (CANARY control). Requires the
 * restrictive journey_manage_execution permission. Setting 'off' cancels pending
 * jobs. Even 'live' only actually sends when the env flags are also on. Audited.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_manage_execution"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const mode = String(body.mode) as WorkflowExecutionMode;
  if (!MODES.includes(mode)) return NextResponse.json({ ok: false, error: "Invalid mode" }, { status: 400 });

  const canaryMaxEnrollments = body.canaryMaxEnrollments === null || typeof body.canaryMaxEnrollments === "number" ? body.canaryMaxEnrollments : undefined;
  const canaryTestPhones = Array.isArray(body.canaryTestPhones) ? body.canaryTestPhones.map(String) : body.canaryTestPhones === null ? null : undefined;

  try {
    const res = await setExecutionMode({ workflowId: params.id, mode, canaryMaxEnrollments, canaryTestPhones, actor });
    return NextResponse.json({ ok: res.ok, mode, cancelledJobs: res.cancelledJobs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
