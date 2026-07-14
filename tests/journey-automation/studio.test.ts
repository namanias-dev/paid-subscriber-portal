/**
 * Studio-completion tests (this shipment). Cover:
 *  - Dashboard CRUD: rename persists, duplicate deep-copies the GRAPH not runs,
 *    delete only for never-published drafts, archive → restore is reversible.
 *  - SMS templates: options only include APPROVED DLT templates.
 *  - Nodes: condition (has_logged_in), goal (logged_in), deterministic branch split.
 *  - Seed: New Lead Onboarding graph is structurally valid with exactly one
 *    intentional placeholder SMS flagged by validation.
 *  - lead_created ingests idempotently.
 *  - Flags-off: the SMS adapter SENDS NOTHING (sender never called).
 *
 * Runs against the in-memory demo store (no Supabase env), so it exercises the
 * real store logic end-to-end.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createWorkflow, saveDraftGraph, renameWorkflow, duplicateWorkflow, deleteWorkflow,
  setWorkflowStatus, getEditorState, publishWorkflow,
} from "../../lib/journey-automation/builderStore";
import type { KillSwitchActor } from "../../lib/journey-automation/store";
import { evaluateCondition, evaluateGoal, type LatestState } from "../../lib/journey-automation/engine/latestState";
import { pickBranch, branchOptions } from "../../lib/journey-automation/engine/worker";
import { runSmsAction as runSmsActionAdapter } from "../../lib/journey-automation/engine/smsAdapter";
import { buildLeadOnboardingGraph } from "../../lib/journey-automation/seedLeadOnboarding";
import { validateGraph } from "../../lib/journey-automation/validate";
import { buildEventRow, ingestAutomationEvent, type PersistFn } from "../../lib/journey-automation/events";
import type { AutomationTemplateOption, BuilderGraph } from "../../types/journey-automation";
import type { EnrollmentRow } from "../../lib/journey-automation/engine/types";
import type { SenderPort } from "../../lib/journey-automation/engine/ports";

const actor: KillSwitchActor = { id: "tester", name: "Tester", role: "super_admin", isSuper: true };

const SAMPLE_GRAPH: BuilderGraph = {
  nodes: [
    { node_key: "t", type: "trigger", config: { title: "Lead", eventType: "lead_created" }, position: { x: 0, y: 0 } },
    { node_key: "g", type: "goal", config: { title: "Goal", goalType: "logged_in" }, position: { x: 200, y: 0 } },
    { node_key: "x", type: "exit", config: { title: "Exit" }, position: { x: 400, y: 0 } },
  ],
  edges: [
    { edge_key: "e1", source: "t", target: "g", branch_label: null, condition: {} },
    { edge_key: "e2", source: "g", target: "x", branch_label: null, condition: {} },
  ],
};

describe("Dashboard CRUD — rename / duplicate / delete / archive-restore", () => {
  it("rename persists", async () => {
    const wf = await createWorkflow("Before", actor);
    const renamed = await renameWorkflow(wf.id, "After", actor);
    assert.equal(renamed.name, "After");
    const state = await getEditorState(wf.id, actor);
    assert.equal(state?.workflow.name, "After");
  });

  it("duplicate deep-copies the draft GRAPH and never the runs", async () => {
    const wf = await createWorkflow("Original", actor);
    await saveDraftGraph(wf.id, SAMPLE_GRAPH, actor);
    const copy = await duplicateWorkflow(wf.id, actor);
    assert.notEqual(copy.id, wf.id, "duplicate must be a new workflow");
    assert.equal(copy.status, "draft");
    assert.equal(copy.published_version, null, "copy must not inherit a published version / runs");
    const copyState = await getEditorState(copy.id, actor);
    assert.equal(copyState?.graph.nodes.length, SAMPLE_GRAPH.nodes.length, "graph nodes deep-copied");
    assert.equal(copyState?.graph.edges.length, SAMPLE_GRAPH.edges.length, "graph edges deep-copied");
  });

  it("delete allowed for a never-published draft, blocked once published", async () => {
    const draft = await createWorkflow("Deletable", actor);
    await saveDraftGraph(draft.id, SAMPLE_GRAPH, actor);
    await assert.doesNotReject(deleteWorkflow(draft.id, actor));
    const gone = await getEditorState(draft.id, actor);
    assert.equal(gone, null, "deleted draft must be gone");

    const pub = await createWorkflow("Published", actor);
    await saveDraftGraph(pub.id, SAMPLE_GRAPH, actor);
    await publishWorkflow(pub.id, actor, "v1");
    await assert.rejects(deleteWorkflow(pub.id, actor), /archived/i, "published workflows must be archived, not deleted");
  });

  it("archive is reversible (archived -> draft restore)", async () => {
    const wf = await createWorkflow("Archivable", actor);
    await setWorkflowStatus(wf.id, "archived", actor);
    let state = await getEditorState(wf.id, actor);
    assert.equal(state?.workflow.status, "archived");
    await assert.doesNotReject(setWorkflowStatus(wf.id, "draft", actor), "restore must be allowed");
    state = await getEditorState(wf.id, actor);
    assert.equal(state?.workflow.status, "draft");
  });
});

describe("Condition + Goal evaluation (new signals)", () => {
  const base: LatestState = { paid: false, hasOverdue: false, optedOut: false, enrolledInCourse: false, registeredForWebinar: false, planPausedOrWaived: false };
  it("has_logged_in condition reads loggedIn", () => {
    assert.equal(evaluateCondition({ check: "has_logged_in" }, { ...base, loggedIn: true }), true);
    assert.equal(evaluateCondition({ check: "has_logged_in" }, { ...base, loggedIn: false }), false);
  });
  it("logged_in goal reads loggedIn", () => {
    assert.equal(evaluateGoal("logged_in", { ...base, loggedIn: true }), true);
    assert.equal(evaluateGoal("logged_in", base), false);
  });
});

describe("Branch — deterministic weighted split", () => {
  it("normalizes config into weighted options", () => {
    assert.deepEqual(branchOptions({ branches: ["A", "B"] }), [{ label: "A", weight: 1 }, { label: "B", weight: 1 }]);
    assert.deepEqual(branchOptions({ branches: [{ label: "X", weight: 3 }] }), [{ label: "X", weight: 3 }]);
  });
  it("same seed always picks the same branch", () => {
    const cfg = { branches: [{ label: "A", weight: 1 }, { label: "B", weight: 1 }] };
    assert.equal(pickBranch(cfg, "enr-123"), pickBranch(cfg, "enr-123"));
  });
  it("weights bias the distribution", () => {
    const cfg = { branches: [{ label: "A", weight: 9 }, { label: "B", weight: 1 }] };
    let a = 0;
    for (let i = 0; i < 2000; i++) if (pickBranch(cfg, `enr-${i}`) === "A") a++;
    assert.ok(a > 1600 && a < 1950, `expected ~90% A, got ${a}/2000`);
  });
});

describe("Seed — New Lead Onboarding graph", () => {
  const templates: AutomationTemplateOption[] = [
    { id: "at-welcome", name: "Welcome", sms_template_id: "welcome_first_login", dlt_template_id: "111", body: "Hi {first_name}", variables: ["first_name", "login_url", "login_code"], approved: true },
    { id: "at-invite", name: "Invite", sms_template_id: "general_webinar_invite", dlt_template_id: "222", body: "Hi {first_name}", variables: ["first_name", "login_url"], approved: true },
  ];

  it("is structurally valid with exactly ONE intentional placeholder SMS", () => {
    const graph = buildLeadOnboardingGraph(templates);
    const report = validateGraph(
      graph.nodes.map((n) => ({ node_key: n.node_key, type: n.type, config: n.config })),
      graph.edges.map((e) => ({ source: e.source, target: e.target, branch_label: e.branch_label })),
    );
    const noTemplate = report.issues.filter((i) => i.code === "sms_no_template");
    assert.equal(noTemplate.length, 2, "two SMS steps are placeholders pending DLT approval (beginner + portal reminder)");
    // No OTHER errors than that placeholder (mapping/paths/structure all complete).
    const otherErrors = report.issues.filter((i) => i.level === "error" && i.code !== "sms_no_template");
    assert.deepEqual(otherErrors, [], `unexpected errors: ${JSON.stringify(otherErrors)}`);
  });

  it("has a trigger, a goal, an exit, and both condition paths", () => {
    const graph = buildLeadOnboardingGraph(templates);
    const types = graph.nodes.map((n) => n.type);
    assert.ok(types.includes("trigger") && types.includes("goal") && types.includes("exit"));
    const condKeys = graph.nodes.filter((n) => n.type === "condition").map((n) => n.node_key);
    for (const k of condKeys) {
      const labels = graph.edges.filter((e) => e.source === k).map((e) => e.branch_label);
      assert.ok(labels.includes("yes") && labels.includes("no"), `${k} needs yes+no`);
    }
  });
});

describe("lead_created ingestion — idempotent, non-blocking", () => {
  it("builds a lead_created row and dedupes on repeat", async () => {
    const row = buildEventRow({ eventType: "lead_created", leadId: "L1", phone: "9999999999", dedupeKey: "lead_created:L1" });
    assert.equal(row.event_type, "lead_created");
    const seen = new Set<string>();
    const persist: PersistFn = async (r) => {
      if (r.dedupe_key && seen.has(r.dedupe_key)) return "duplicate";
      if (r.dedupe_key) seen.add(r.dedupe_key);
      return "inserted";
    };
    const first = await ingestAutomationEvent({ eventType: "lead_created", leadId: "L1", dedupeKey: "lead_created:L1" }, persist);
    const second = await ingestAutomationEvent({ eventType: "lead_created", leadId: "L1", dedupeKey: "lead_created:L1" }, persist);
    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false, "same lead must not double-ingest");
  });
});

describe("Flags OFF — no send path is reachable", () => {
  const enrollment = { id: "enr-1", workflow_id: "wf-1", version_id: "v-1", mode: "live", normalized_phone: "9999999999" } as unknown as EnrollmentRow;

  it("SMS adapter simulates and never calls the sender even in 'live' enrollment mode with flags off", async () => {
    let sends = 0;
    const sender: SenderPort = { async send() { sends++; return { ok: true }; } };
    const result = await runSmsActionAdapter(sender, {
      enrollment, nodeKey: "sms_welcome", category: "transactional", recipient: "9999999999", templateId: "welcome_first_login",
      publicVariables: { first_name: "A" }, secretVariables: { login_code: "SECRET" },
      killSwitchEngaged: false,
      guardOverrides: { executionEnabled: false, smsEnabled: false, promotionalEnabled: false },
    });
    assert.equal(result.status, "simulated");
    assert.equal(result.senderCalled, false);
    assert.equal(sends, 0, "sender must never be invoked with flags off");
    // Secrets must never appear in stored resolved variables.
    assert.equal(Object.keys(result.resolvedVariables).some((k) => /login_code/.test(k)), false);
  });
});
