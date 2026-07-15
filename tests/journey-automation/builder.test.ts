/**
 * Builder UX + graph-model tests (this shipment). Cover:
 *  - PART A: every seeded condition has BOTH a Yes and No path (no dead-ends).
 *  - Round-trip: graph -> canvas -> graph preserves edges, branch handles, notes.
 *  - Condition enforces exactly ONE edge per Yes/No handle (replace, not stack).
 *  - Quick-add produces a node CONNECTED to the source handle (no orphan branch).
 *  - Cycle + self-connect prevention.
 *  - Notes are excluded from validation (never flagged disconnected).
 *
 * Pure/in-memory: no @xyflow import, no network, nothing sends.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  outputHandles, graphEdgesToRF, graphEdgesFromRF, planConnection, wouldCreateCycle,
  executableGraph, edgeFromRF, type RFEdgeLite,
} from "../../lib/journey-automation/builderGraphMap";
import { validateGraph } from "../../lib/journey-automation/validate";
import { buildLeadOnboardingGraph } from "../../lib/journey-automation/seedLeadOnboarding";
import { JOURNEY_DEFS } from "../../lib/journey-automation/seedJourneySet";
import type { AutomationTemplateOption, BuilderGraph } from "../../types/journey-automation";

const APPROVED: AutomationTemplateOption[] = [
  { id: "at-welcome", name: "Welcome", sms_template_id: "welcome_first_login", dlt_template_id: "1", body: "Hi {first_name}", variables: ["first_name", "login_url", "login_code"], approved: true },
  { id: "at-invite", name: "Invite", sms_template_id: "general_webinar_invite", dlt_template_id: "2", body: "Hi {first_name}", variables: ["first_name", "login_url"], approved: true },
  { id: "at-pay", name: "Pay", sms_template_id: "payment_successful", dlt_template_id: "3", body: "Hi {first_name}", variables: ["first_name", "item_short", "login_url", "login_code"], approved: true },
  { id: "at-webreg", name: "Confirmed", sms_template_id: "webinar_registered", dlt_template_id: "4", body: "Hi {first_name}", variables: ["first_name", "login_url", "login_code"], approved: true },
];
const byKey = new Map(APPROVED.map((t) => [t.sms_template_id, t]));

const ALL_GRAPHS: { name: string; graph: BuilderGraph }[] = [
  { name: "New Lead Onboarding", graph: buildLeadOnboardingGraph(APPROVED) },
  ...JOURNEY_DEFS.map((d) => ({ name: d.name, graph: d.build(byKey) })),
];

function reportOf(graph: BuilderGraph) {
  const exec = executableGraph(graph);
  return validateGraph(
    exec.nodes.map((n) => ({ node_key: n.node_key, type: n.type, config: n.config })),
    exec.edges.map((e) => ({ source: e.source, target: e.target, branch_label: e.branch_label })),
  );
}

describe("PART A — every seeded condition has both Yes and No connected", () => {
  for (const { name, graph } of ALL_GRAPHS) {
    it(`${name}: no condition_no_yes / condition_no_no`, () => {
      const rep = reportOf(graph);
      const missing = rep.issues.filter((i) => i.code === "condition_no_yes" || i.code === "condition_no_no");
      assert.deepEqual(missing, [], `dangling condition path(s): ${JSON.stringify(missing)}`);
      // Also assert directly on the graph: every condition has yes+no edges.
      for (const c of graph.nodes.filter((n) => n.type === "condition")) {
        const labels = graph.edges.filter((e) => e.source === c.node_key).map((e) => (e.branch_label ?? "").toLowerCase());
        assert.ok(labels.includes("yes") && labels.includes("no"), `${name}/${c.node_key} missing yes+no`);
      }
    });
  }

  it("a condition missing its Yes edge IS caught", () => {
    const g: BuilderGraph = {
      nodes: [
        { node_key: "t", type: "trigger", config: { eventType: "lead_created" }, position: { x: 0, y: 0 } },
        { node_key: "c", type: "condition", config: { title: "Has logged in?", check: "has_logged_in" }, position: { x: 1, y: 0 } },
        { node_key: "g", type: "goal", config: { goalType: "logged_in" }, position: { x: 2, y: 0 } },
        { node_key: "x", type: "exit", config: {}, position: { x: 3, y: 0 } },
      ],
      edges: [
        { edge_key: "e1", source: "t", target: "c", branch_label: null, condition: {} },
        { edge_key: "e2", source: "c", target: "g", branch_label: "no", condition: {} },
        { edge_key: "e3", source: "g", target: "x", branch_label: null, condition: {} },
      ],
    };
    const codes = reportOf(g).issues.map((i) => i.code);
    assert.ok(codes.includes("condition_no_yes"));
  });
});

describe("Output handles", () => {
  it("condition exposes yes + no; branch exposes its labels", () => {
    assert.deepEqual(outputHandles({ type: "condition", config: {} }), ["yes", "no"]);
    assert.deepEqual(outputHandles({ type: "branch", config: { branches: [{ label: "A", weight: 1 }, { label: "B", weight: 1 }] } }), ["a", "b"]);
    assert.deepEqual(outputHandles({ type: "send_sms", config: {} }), []);
  });
});

describe("Round-trip graph <-> canvas keeps edges, handles and notes", () => {
  const graph: BuilderGraph = {
    nodes: [
      { node_key: "t", type: "trigger", config: { eventType: "lead_created" }, position: { x: 0, y: 0 } },
      { node_key: "c", type: "condition", config: { check: "has_logged_in" }, position: { x: 1, y: 0 } },
      { node_key: "a", type: "send_sms", config: { automationTemplateId: "x" }, position: { x: 2, y: -1 } },
      { node_key: "b", type: "exit", config: {}, position: { x: 2, y: 1 } },
      { node_key: "note1", type: "note", config: { text: "Remember to submit DLT" }, position: { x: 5, y: 5 } },
    ],
    edges: [
      { edge_key: "e1", source: "t", target: "c", branch_label: null, condition: {} },
      { edge_key: "e2", source: "c", target: "a", branch_label: "yes", condition: {} },
      { edge_key: "e3", source: "c", target: "b", branch_label: "no", condition: {} },
    ],
  };

  it("condition edges carry their handle and survive the round-trip", () => {
    const rf = graphEdgesToRF(graph);
    const yes = rf.find((e) => e.id === "e2");
    const no = rf.find((e) => e.id === "e3");
    assert.equal(yes?.sourceHandle, "yes");
    assert.equal(no?.sourceHandle, "no");
    // Non-branch source has no handle.
    assert.equal(rf.find((e) => e.id === "e1")?.sourceHandle, null);

    const back = graphEdgesFromRF(rf, graph.nodes);
    assert.equal(back.find((e) => e.edge_key === "e2")?.branch_label, "yes");
    assert.equal(back.find((e) => e.edge_key === "e3")?.branch_label, "no");
    assert.equal(back.find((e) => e.edge_key === "e1")?.branch_label, null);
  });

  it("note node survives and never affects validation", () => {
    const exec = executableGraph(graph);
    assert.equal(exec.nodes.some((n) => n.type === "note"), false, "note excluded from executable graph");
    // Full validate (incl the note) must NOT flag the note as disconnected.
    const rep = validateGraph(
      graph.nodes.map((n) => ({ node_key: n.node_key, type: n.type, config: n.config })),
      graph.edges.map((e) => ({ source: e.source, target: e.target, branch_label: e.branch_label })),
    );
    assert.equal(rep.issues.some((i) => i.nodeKey === "note1"), false, "note must never be flagged");
  });
});

describe("planConnection — one edge per handle, acyclic", () => {
  const edges = [
    { edge_key: "e_yes", source: "c", target: "a", branch_label: "yes" },
    { edge_key: "e_no", source: "c", target: "b", branch_label: "no" },
  ];
  it("re-connecting the Yes handle REPLACES the old Yes edge (not stack)", () => {
    const plan = planConnection(edges, { source: "c", target: "z", sourceHandle: "yes", sourceType: "condition" });
    assert.equal(plan.ok, true);
    assert.equal(plan.branch_label, "yes");
    assert.deepEqual(plan.replaces, ["e_yes"], "must replace the existing Yes edge only");
  });
  it("connecting the No handle replaces only No", () => {
    const plan = planConnection(edges, { source: "c", target: "z", sourceHandle: "no", sourceType: "condition" });
    assert.deepEqual(plan.replaces, ["e_no"]);
  });
  it("rejects a self-connection", () => {
    const plan = planConnection(edges, { source: "c", target: "c", sourceHandle: "yes", sourceType: "condition" });
    assert.equal(plan.ok, false);
  });
  it("rejects a cycle", () => {
    const chain = [
      { edge_key: "e1", source: "a", target: "b", branch_label: null },
      { edge_key: "e2", source: "b", target: "c", branch_label: null },
    ];
    assert.equal(wouldCreateCycle(chain, "c", "a"), true);
    const plan = planConnection(chain, { source: "c", target: "a", sourceHandle: null, sourceType: "wait" });
    assert.equal(plan.ok, false);
  });
});

describe("Quick-add produces a CONNECTED node (no orphan branch)", () => {
  it("edge from the source handle gets the right branch_label", () => {
    // Simulate: user drags from condition 'no' handle into empty canvas, picks SMS.
    const existing = [{ edge_key: "e_yes", source: "c", target: "a", branch_label: "yes" }];
    const plan = planConnection(existing, { source: "c", target: "newnode", sourceHandle: "no", sourceType: "condition" });
    assert.equal(plan.ok, true);
    // The created edge (as the builder builds it) maps back to branch_label "no".
    const rfEdge: RFEdgeLite = { id: "e_new", source: "c", target: "newnode", sourceHandle: "no", data: { branch_label: plan.branch_label } };
    const stored = edgeFromRF(rfEdge, "condition");
    assert.equal(stored.branch_label, "no");
    assert.equal(stored.target, "newnode");
  });
});
