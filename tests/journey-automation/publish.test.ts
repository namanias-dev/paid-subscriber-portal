/**
 * Part B — publish semantics (runs against the no-DB in-memory store).
 *  (i)   Publish creates an IMMUTABLE version with a frozen graph snapshot.
 *  (ii)  Publish opens the next editable draft (version+1).
 *  (iii) Publish does NOT enable execution — the flags stay OFF and the fail-closed
 *        guard still blocks every action. Publishing arms, it does not run.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createWorkflow,
  saveDraftGraph,
  publishWorkflow,
  getEditorState,
} from "../../lib/journey-automation/builderStore";
import { isVersionImmutable } from "../../lib/journey-automation/versioning";
import { canExecuteJourneys } from "../../lib/journey-automation/guards";
import { journeyExecutionEnabled } from "../../lib/journey-automation/flags";

const actor = { id: "tester", name: "Tester", role: "super_admin", isSuper: true };

const graph = {
  nodes: [
    { node_key: "t", type: "trigger", config: { title: "Payment received", eventType: "payment_received" }, position: { x: 0, y: 0 } },
    { node_key: "g", type: "goal", config: { title: "Paid", goalType: "payment_completed" }, position: { x: 0, y: 120 } },
  ],
  edges: [{ edge_key: "e1", source: "t", target: "g", branch_label: null }],
};

describe("publish — immutable version without enabling execution", () => {
  it("freezes an immutable published version, opens next draft, and never enables execution", async () => {
    delete process.env.JOURNEY_AUTOMATION_EXECUTION_ENABLED;

    const wf = await createWorkflow("Publish Test", actor);
    await saveDraftGraph(wf.id, graph, actor, "initial");
    const res = await publishWorkflow(wf.id, actor, "v1");
    assert.equal(res.publishedVersion, 1);

    const state = await getEditorState(wf.id, actor);
    assert.ok(state);
    const published = state!.versions.find((v) => v.status === "published");
    assert.ok(published, "a published version should exist");
    assert.equal(published!.is_immutable, true);
    assert.equal(isVersionImmutable(published!), true);
    // Frozen snapshot carries the graph.
    const def = published!.definition as { nodes?: unknown[] };
    assert.equal(Array.isArray(def.nodes) ? def.nodes.length : 0, 2);

    // A fresh editable draft (v2) was opened.
    assert.ok(state!.versions.some((v) => v.status === "draft" && v.version === 2));

    // CRITICAL: publishing does NOT enable execution.
    assert.equal(journeyExecutionEnabled(), false);
    assert.equal(canExecuteJourneys().allowed, false);
    assert.equal(canExecuteJourneys().reason, "execution_disabled");
  });
});
