import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { getEditorState, saveDraftGraph } from "@/lib/journey-automation/builderStore";
import type { BuilderGraph } from "@/types/journey-automation";

export const dynamic = "force-dynamic";

/** Full editor state (workflow + current draft + graph + version history). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_view"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const state = await getEditorState(params.id, actor);
  if (!state) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...state });
}

/** Save the draft graph. Requires journey_edit_draft. Audited. Never sends/executes. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_edit_draft"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const graph = body.graph as BuilderGraph | undefined;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return NextResponse.json({ ok: false, error: "Invalid graph" }, { status: 400 });
  }
  try {
    await saveDraftGraph(params.id, graph, actor, typeof body.changeSummary === "string" ? body.changeSummary : null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
