import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { getEditorState, saveDraftGraph, renameWorkflow, deleteWorkflow } from "@/lib/journey-automation/builderStore";
import { journeyFlagSnapshot } from "@/lib/journey-automation/flags";
import { getSettings } from "@/lib/journey-automation/store";
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
  // Effective-state inputs: the server flags + kill switch so the builder can show
  // the HONEST running state (e.g. "Live (engine OFF — not running)").
  const settings = await getSettings();
  return NextResponse.json({
    ok: true,
    ...state,
    flags: journeyFlagSnapshot(),
    killSwitch: { engaged: settings.kill_switch_engaged },
  });
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

/** Rename a workflow (persists). Requires journey_edit_draft. Audited. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_edit_draft"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
  try {
    const workflow = await renameWorkflow(params.id, name, actor);
    return NextResponse.json({ ok: true, workflow });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

/**
 * Hard-delete a workflow. Only ever allowed for a never-published draft (the
 * store enforces this); published workflows must be archived. Requires
 * journey_edit_draft. Audited (ledger survives via on-delete-set-null FK).
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_edit_draft"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    await deleteWorkflow(params.id, actor);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
