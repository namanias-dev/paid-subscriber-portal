/**
 * Part B — pre-publish validation tests. Pure logic; no I/O. Proves the builder's
 * publish gate catches structural + compliance problems and passes a well-formed
 * journey.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateGraph, type GraphNode, type GraphEdge } from "../../lib/journey-automation/validate";

function codes(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  return validateGraph(nodes, edges).issues.map((i) => i.code);
}

describe("validateGraph — structural rules", () => {
  it("flags an empty graph", () => {
    const rep = validateGraph([], []);
    assert.equal(rep.ok, false);
    assert.ok(rep.issues.some((i) => i.code === "empty"));
  });

  it("requires trigger, goal and exit", () => {
    const c = codes([{ node_key: "s", type: "send_sms", config: {} }], []);
    assert.ok(c.includes("no_trigger"));
    assert.ok(c.includes("no_goal"));
    assert.ok(c.includes("no_exit"));
  });

  it("flags a disconnected node", () => {
    const nodes: GraphNode[] = [
      { node_key: "t", type: "trigger", config: { eventType: "payment_received" } },
      { node_key: "g", type: "goal", config: {} },
      { node_key: "e", type: "exit", config: {} },
      { node_key: "orphan", type: "wait", config: {} },
    ];
    const edges: GraphEdge[] = [{ source: "t", target: "g" }, { source: "t", target: "e" }];
    const c = codes(nodes, edges);
    assert.ok(c.includes("disconnected"));
  });

  it("detects a waitless infinite loop", () => {
    const nodes: GraphNode[] = [
      { node_key: "t", type: "trigger", config: {} },
      { node_key: "a", type: "condition", config: {} },
      { node_key: "b", type: "condition", config: {} },
      { node_key: "g", type: "goal", config: {} },
      { node_key: "e", type: "exit", config: {} },
    ];
    const edges: GraphEdge[] = [
      { source: "t", target: "a" }, { source: "a", target: "b" }, { source: "b", target: "a" },
      { source: "a", target: "g" }, { source: "b", target: "e" },
    ];
    assert.ok(codes(nodes, edges).includes("infinite_loop"));
  });
});

describe("validateGraph — SMS compliance rules", () => {
  const base: GraphNode[] = [
    { node_key: "t", type: "trigger", config: { eventType: "payment_received" } },
    { node_key: "g", type: "goal", config: {} },
    { node_key: "e", type: "exit", config: {} },
  ];

  it("flags an SMS node without a template and without mapped variables", () => {
    const nodes: GraphNode[] = [
      ...base,
      { node_key: "s", type: "send_sms", config: { templateVariables: ["name"], variableMapping: {} } },
    ];
    const edges: GraphEdge[] = [{ source: "t", target: "s" }, { source: "s", target: "g" }, { source: "s", target: "e" }];
    const c = codes(nodes, edges);
    assert.ok(c.includes("sms_no_template"));
    assert.ok(c.includes("sms_unmapped_vars"));
  });

  it("warns when frequency cap / quiet hours are missing", () => {
    const nodes: GraphNode[] = [
      ...base,
      { node_key: "s", type: "send_sms", config: { automationTemplateId: "tpl1", templateVariables: [], variableMapping: {} } },
    ];
    const edges: GraphEdge[] = [{ source: "t", target: "s" }, { source: "s", target: "g" }, { source: "s", target: "e" }];
    const c = codes(nodes, edges);
    assert.ok(c.includes("sms_no_freq_cap"));
    assert.ok(c.includes("sms_no_quiet_hours"));
  });
});

describe("validateGraph — happy path", () => {
  it("passes a well-formed compliant journey with no errors", () => {
    const nodes: GraphNode[] = [
      { node_key: "t", type: "trigger", config: { eventType: "payment_received", title: "Payment received" } },
      { node_key: "s", type: "send_sms", config: { title: "Thank you", automationTemplateId: "tpl1", templateVariables: ["name"], variableMapping: { name: "student.name" }, frequencyCap: { max: 1, perDays: 1 }, quietHours: { start: "21:00", end: "08:00" } } },
      { node_key: "g", type: "goal", config: { title: "Paid", goalType: "payment_completed" } },
      { node_key: "e", type: "exit", config: { title: "End" } },
    ];
    const edges: GraphEdge[] = [{ source: "t", target: "s" }, { source: "s", target: "g" }, { source: "s", target: "e" }];
    const rep = validateGraph(nodes, edges);
    assert.equal(rep.errors, 0, JSON.stringify(rep.issues));
    assert.equal(rep.ok, true);
  });
});
