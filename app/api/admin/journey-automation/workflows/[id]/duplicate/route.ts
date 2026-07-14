import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { duplicateWorkflow } from "@/lib/journey-automation/builderStore";

export const dynamic = "force-dynamic";

/** Duplicate a workflow into a new DRAFT. Requires journey_create_draft. Audited. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_create_draft"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const wf = await duplicateWorkflow(params.id, actor);
    return NextResponse.json({ ok: true, workflow: wf });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
