import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { getEditorState } from "@/lib/journey-automation/builderStore";
import { validateGraph } from "@/lib/journey-automation/validate";
import { writeAudit } from "@/lib/journey-automation/store";

export const dynamic = "force-dynamic";

/**
 * Run pre-publish validation on the current draft graph. Authoring-only: computes
 * a report, never sends/executes. Requires journey_view; audited as an edit note.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_view"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const state = await getEditorState(params.id, actor);
  if (!state) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const report = validateGraph(
    state.graph.nodes.map((n) => ({ node_key: n.node_key, type: n.type, config: n.config })),
    state.graph.edges.map((e) => ({ source: e.source, target: e.target, branch_label: e.branch_label })),
  );
  await writeAudit({ workflow_id: params.id, version_id: state.draftVersion.id, action: "edit", actor, summary: `Validated draft: ${report.ok ? "ready to publish" : `${report.errors} issue(s)`}`, before: null, after: { errors: report.errors, warnings: report.warnings } });
  return NextResponse.json({ ok: true, report });
}
