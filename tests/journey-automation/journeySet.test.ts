/**
 * Full-journey-set tests (this shipment). Cover:
 *  - DRAFT DLT templates: <=150 chars, brand present, variable map matches body.
 *  - Every seeded journey validates with ONLY "pending DLT approval" errors — no
 *    structural errors (no dangling, dead-end, unmapped, unreachable, or missing
 *    condition path). Every condition has BOTH a Yes and a No path.
 *  - Per-NODE simulation: wait duration from authored config, condition + goal
 *    evaluation, SMS records a would-send MINUS secrets.
 *  - Installment latest-state: pays during wait -> reminder suppressed + goal met.
 *  - Validation catches a deliberately broken graph.
 *  - Flags OFF -> the SMS adapter never calls the sender.
 *
 * Pure/in-memory: no Supabase env, no network, nothing sends.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkAllDrafts, DRAFT_SMS_TEMPLATES } from "../../lib/journey-automation/draftTemplates";
import { JOURNEY_DEFS } from "../../lib/journey-automation/seedJourneySet";
import { buildLeadOnboardingGraph } from "../../lib/journey-automation/seedLeadOnboarding";
import { validateGraph } from "../../lib/journey-automation/validate";
import { waitMsFromConfig } from "../../lib/journey-automation/engine/worker";
import {
  evaluateCondition, evaluateGoal, shouldSuppressReminder, type LatestState,
} from "../../lib/journey-automation/engine/latestState";
import { runSmsAction } from "../../lib/journey-automation/engine/smsAdapter";
import type { AutomationTemplateOption, BuilderGraph } from "../../types/journey-automation";
import type { EnrollmentRow } from "../../lib/journey-automation/engine/types";
import type { SenderPort } from "../../lib/journey-automation/engine/ports";

/** Approved templates the journeys reuse (fake but shaped like the real options). */
const APPROVED: AutomationTemplateOption[] = [
  { id: "at-welcome", name: "Welcome", sms_template_id: "welcome_first_login", dlt_template_id: "1", body: "Hi {first_name} {login_url} {login_code}", variables: ["first_name", "login_url", "login_code"], approved: true },
  { id: "at-invite", name: "Invite", sms_template_id: "general_webinar_invite", dlt_template_id: "2", body: "Hi {first_name} {login_url}", variables: ["first_name", "login_url"], approved: true },
  { id: "at-pay", name: "Payment Success", sms_template_id: "payment_successful", dlt_template_id: "3", body: "Hi {first_name} {item_short} {login_url} {login_code}", variables: ["first_name", "item_short", "login_url", "login_code"], approved: true },
  { id: "at-webreg", name: "Webinar Confirmed", sms_template_id: "webinar_registered", dlt_template_id: "4", body: "Hi {first_name} {login_url} {login_code}", variables: ["first_name", "login_url", "login_code"], approved: true },
  { id: "at-paypend", name: "Payment Pending", sms_template_id: "payment_pending", dlt_template_id: "5", body: "Hi {first_name} {item_short} {login_url} {login_code}", variables: ["first_name", "item_short", "login_url", "login_code"], approved: true },
  { id: "at-aband", name: "Abandoned Nudge", sms_template_id: "abandoned_nudge", dlt_template_id: "6", body: "Hi {first_name} {item_short} {login_url} {login_code}", variables: ["first_name", "item_short", "login_url", "login_code"], approved: true },
  { id: "at-zoom", name: "Zoom Ready", sms_template_id: "zoom_ready", dlt_template_id: "7", body: "Hi {first_name} {login_url} {login_code}", variables: ["first_name", "login_url", "login_code"], approved: true },
  { id: "at-soon", name: "Starting Soon", sms_template_id: "starting_soon_1hr", dlt_template_id: "8", body: "Hi {first_name} {item_short} {login_url} {login_code}", variables: ["first_name", "item_short", "login_url", "login_code"], approved: true },
];
const byKey = new Map(APPROVED.map((t) => [t.sms_template_id, t]));

function reportOf(graph: BuilderGraph) {
  return validateGraph(
    graph.nodes.map((n) => ({ node_key: n.node_key, type: n.type, config: n.config })),
    graph.edges.map((e) => ({ source: e.source, target: e.target, branch_label: e.branch_label })),
  );
}

const ALL_GRAPHS: { name: string; graph: BuilderGraph }[] = [
  { name: "New Lead Onboarding", graph: buildLeadOnboardingGraph(APPROVED) },
  ...JOURNEY_DEFS.map((d) => ({ name: d.name, graph: d.build(byKey) })),
];

describe("DRAFT DLT templates", () => {
  it("all drafts are <=150 chars, contain the brand, and map matches body", () => {
    const checks = checkAllDrafts();
    assert.equal(checks.length, DRAFT_SMS_TEMPLATES.length);
    for (const c of checks) {
      assert.ok(c.withinLimit, `${c.template_key} is ${c.chars} chars (> 150)`);
      assert.ok(c.hasBrand, `${c.template_key} missing brand line`);
      assert.ok(c.mapMatchesBody, `${c.template_key} variable map != body variables`);
      assert.ok(c.loginUrl.startsWith("https://www.namanias.com/"), `${c.template_key} uses a non-whitelisted URL`);
    }
  });
});

describe("Every seeded journey validates — Ready to publish, no false pending", () => {
  for (const { name, graph } of ALL_GRAPHS) {
    it(`${name}: no structural errors; only sms_no_template`, () => {
      const rep = reportOf(graph);
      const other = rep.issues.filter((i) => i.level === "error" && i.code !== "sms_no_template");
      assert.deepEqual(other, [], `unexpected blocking errors: ${JSON.stringify(other)}`);
    });
    it(`${name}: every SMS binds a REAL approved template (zero false pending)`, () => {
      // With the full approved Mission-Control set available, no step is pending.
      const rep = reportOf(graph);
      const pending = rep.issues.filter((i) => i.code === "sms_no_template");
      assert.deepEqual(pending, [], `${name} has false-pending steps: ${JSON.stringify(pending)}`);
      for (const n of graph.nodes.filter((n) => n.type === "send_sms")) {
        const id = n.config?.["automationTemplateId"];
        assert.ok(id, `${name}/${n.node_key} must bind an approved template`);
        // The bound id resolves to a real approved option (single source of truth).
        assert.ok(APPROVED.some((t) => t.id === id), `${name}/${n.node_key} bound to unknown template ${String(id)}`);
      }
    });
    it(`${name}: every condition has BOTH a Yes and No path`, () => {
      const condKeys = graph.nodes.filter((n) => n.type === "condition").map((n) => n.node_key);
      for (const k of condKeys) {
        const labels = graph.edges.filter((e) => e.source === k).map((e) => String(e.branch_label ?? "").toLowerCase());
        assert.ok(labels.includes("yes") && labels.includes("no"), `${name}/${k} missing yes+no`);
      }
    });
    it(`${name}: has a trigger, a goal, and an exit`, () => {
      const types = new Set(graph.nodes.map((n) => n.type));
      assert.ok(types.has("trigger") && types.has("goal") && types.has("exit"), `${name} missing terminal(s)`);
    });
  }
});

describe("Per-NODE simulation", () => {
  const base: LatestState = { paid: false, hasOverdue: true, optedOut: false, enrolledInCourse: false, registeredForWebinar: false, planPausedOrWaived: false, loggedIn: false };

  it("wait node reads the authored durationValue/durationUnit", () => {
    assert.equal(waitMsFromConfig({ durationValue: 2, durationUnit: "days" }, 0), 2 * 24 * 3600 * 1000);
    assert.equal(waitMsFromConfig({ durationValue: 1, durationUnit: "days" }, 0), 24 * 3600 * 1000);
  });
  it("condition is_paid flips on latest state", () => {
    assert.equal(evaluateCondition({ check: "is_paid" }, { ...base, paid: true }), true);
    assert.equal(evaluateCondition({ check: "is_paid" }, base), false);
  });
  it("goal payment_completed / logged_in score correctly", () => {
    assert.equal(evaluateGoal("payment_completed", { ...base, paid: true }), true);
    assert.equal(evaluateGoal("logged_in", { ...base, loggedIn: true }), true);
    assert.equal(evaluateGoal("logged_in", base), false);
  });
});

describe("Installment latest-state safety", () => {
  const overdue: LatestState = { paid: false, hasOverdue: true, optedOut: false, enrolledInCourse: false, registeredForWebinar: false, planPausedOrWaived: false };
  it("pays during the wait -> reminder suppressed AND goal met (journey ends)", () => {
    const afterPayment: LatestState = { ...overdue, paid: true, hasOverdue: false };
    assert.equal(shouldSuppressReminder("payment_reminder", afterPayment).suppress, true);
    assert.equal(evaluateGoal("payment_completed", afterPayment), true);
    // Still overdue and unpaid -> reminder allowed.
    assert.equal(shouldSuppressReminder("payment_reminder", overdue).suppress, false);
  });
});

describe("Validation catches a broken graph", () => {
  it("flags dangling, disconnected, missing condition path, and unmapped SMS vars", () => {
    const graph: BuilderGraph = {
      nodes: [
        { node_key: "t", type: "trigger", config: { title: "T", eventType: "lead_created" }, position: { x: 0, y: 0 } },
        { node_key: "c", type: "condition", config: { title: "C", check: "is_paid" }, position: { x: 1, y: 0 } },
        { node_key: "s", type: "send_sms", config: { title: "S", automationTemplateId: "x", templateVariables: ["first_name"], variableMapping: {} }, position: { x: 2, y: 0 } },
        { node_key: "orphan", type: "wait", config: { title: "Orphan", durationValue: 1, durationUnit: "days" }, position: { x: 3, y: 0 } },
        { node_key: "g", type: "goal", config: { title: "G", goalType: "logged_in" }, position: { x: 4, y: 0 } },
        { node_key: "x", type: "exit", config: { title: "X" }, position: { x: 5, y: 0 } },
      ],
      edges: [
        { edge_key: "e1", source: "t", target: "c", branch_label: null, condition: {} },
        { edge_key: "e2", source: "c", target: "s", branch_label: "yes", condition: {} },
        { edge_key: "e3", source: "s", target: "g", branch_label: null, condition: {} },
        { edge_key: "e4", source: "g", target: "x", branch_label: null, condition: {} },
      ],
    };
    const rep = reportOf(graph);
    const codes = new Set(rep.issues.map((i) => i.code));
    assert.ok(codes.has("condition_no_no"), "missing No path not caught");
    assert.ok(codes.has("disconnected"), "orphan node not caught");
    assert.ok(codes.has("sms_unmapped_vars"), "unmapped SMS variable not caught");
    assert.equal(rep.ok, false);
  });
});

describe("Flags OFF — payment reminder never sends", () => {
  const enrollment = { id: "enr-2", workflow_id: "wf-2", version_id: "v-2", mode: "live", normalized_phone: "9999999999" } as unknown as EnrollmentRow;
  it("payment_reminder SMS simulates and never calls the sender", async () => {
    let sends = 0;
    const sender: SenderPort = { async send() { sends++; return { ok: true }; } };
    const res = await runSmsAction(sender, {
      enrollment, nodeKey: "sms_overdue", category: "payment_reminder", recipient: "9999999999", templateId: "installment_overdue_reminder",
      publicVariables: { first_name: "A", item_short: "UPSC 2027" }, secretVariables: { login_url: "SECRET", login_code: "SECRET" },
      killSwitchEngaged: false,
      guardOverrides: { executionEnabled: false, smsEnabled: false, promotionalEnabled: false },
      paymentRemindersEnabled: false,
    });
    assert.equal(res.status, "simulated");
    assert.equal(res.senderCalled, false);
    assert.equal(sends, 0);
    assert.equal(Object.keys(res.resolvedVariables).some((k) => /login_url|login_code/.test(k)), false, "secrets must not be stored");
  });
});
