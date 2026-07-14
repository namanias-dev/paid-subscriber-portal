import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { createWorkflow } from "@/lib/journey-automation/builderStore";

export const dynamic = "force-dynamic";

/** Create a new DRAFT workflow. Requires journey_create_draft. Audited. */
export async function POST(req: Request) {
  if (!(await requirePermission("journey_create_draft"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name : "Untitled journey";
  try {
    const wf = await createWorkflow(name, actor);
    return NextResponse.json({ ok: true, workflow: wf });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
