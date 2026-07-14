import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { getEditorState, publishWorkflow } from "@/lib/journey-automation/builderStore";
import { validateGraph } from "@/lib/journey-automation/validate";

export const dynamic = "force-dynamic";

/**
 * Publish the current draft as an IMMUTABLE version. Requires journey_publish.
 * This does NOT enable execution — all six flags stay off and no engine exists.
 * The published version is frozen (DB trigger enforces immutability). Audited.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_publish"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const state = await getEditorState(params.id, actor);
  if (!state) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  // Block publishing an invalid graph (must pass pre-publish validation).
  const report = validateGraph(
    state.graph.nodes.map((n) => ({ node_key: n.node_key, type: n.type, config: n.config })),
    state.graph.edges.map((e) => ({ source: e.source, target: e.target, branch_label: e.branch_label })),
  );
  if (!report.ok) {
    return NextResponse.json({ ok: false, error: "Validation failed", report }, { status: 422 });
  }

  const body = await req.json().catch(() => ({}));
  const changeSummary = typeof body.changeSummary === "string" && body.changeSummary.trim() ? body.changeSummary.trim() : null;
  try {
    const res = await publishWorkflow(params.id, actor, changeSummary);
    return NextResponse.json({
      ok: true,
      publishedVersion: res.publishedVersion,
      // Explicit: publishing never enables execution this shipment.
      executionEnabled: false,
      note: "Published — will run once execution is enabled.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
