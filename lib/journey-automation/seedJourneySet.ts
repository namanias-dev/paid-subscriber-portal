/**
 * Seed the full expert-designed journey set as VALIDATED DRAFTS.
 *
 * SAFETY: writes AUTHORING intent only (draft graphs). Never publishes, never
 * enables execution, never flips a flag, never sends. execution_mode stays 'off'.
 * Steps whose template is not yet DLT-approved reference it by stable key and are
 * flagged "pending DLT approval" by validation + the inspector.
 *
 * Idempotent: re-running is a no-op once a workflow with the same name exists.
 *
 * Journeys (see docs + PART A strategy in the shipment report):
 *   1. New Lead Onboarding                  (lead_created)        [seedLeadOnboarding.ts]
 *   2. Installment Reminders                (installment_overdue)
 *   3. Payment Thank-You & Activation       (payment_received)
 *   4. Webinar Onboarding & Attendance      (webinar_registered)
 */
import type { BuilderGraph, BuilderNode, AutomationTemplateOption } from "@/types/journey-automation";
import type { KillSwitchActor } from "./store";
import { listWorkflows } from "./store";
import { createWorkflow, saveDraftGraph, listTemplateOptions } from "./builderStore";
import { smsNode } from "./seedLeadOnboarding";

function pos(x: number, y: number) { return { x, y }; }
function edge(source: string, target: string, branch_label: string | null = null) {
  return { edge_key: `${source}__${target}`, source, target, branch_label, condition: {} };
}
/** Identity variable map (first_name -> first_name, …) for an approved template. */
function idMap(t?: AutomationTemplateOption): Record<string, string> {
  const m: Record<string, string> = {};
  for (const v of t?.variables ?? []) m[v] = v;
  return m;
}

export interface JourneyDef {
  name: string;
  description: string;
  build: (byKey: Map<string, AutomationTemplateOption>) => BuilderGraph;
}

// ---------------------------------------------------------------------------
// 2. Installment Reminders — trigger installment_overdue, goal payment_completed.
//    Every SMS is category payment_reminder -> auto-suppressed the instant the
//    student pays (latest-state revalidation). The goal (payment_completed) also
//    ends the journey pre-node once paid.
// ---------------------------------------------------------------------------
function buildInstallmentReminders(byKey: Map<string, AutomationTemplateOption>): BuilderGraph {
  // Closest approved dunning templates (both PAYMENT use_case, login+pay CTA):
  //   overdue → payment_pending ("fee is pending, log in & upload proof")
  //   final   → abandoned_nudge ("complete your pending payment")
  const overdue = byKey.get("payment_pending");
  const final = byKey.get("abandoned_nudge");
  const nodes: BuilderNode[] = [
    { node_key: "trigger_overdue", type: "trigger", position: pos(0, 0), config: { title: "Installment overdue", eventType: "installment_overdue" } },
    smsNode("sms_overdue", "Overdue reminder", "payment_reminder", overdue, idMap(overdue), pos(260, 0), "installment_overdue_reminder"),
    { node_key: "wait_2d_a", type: "wait", position: pos(520, 0), config: { title: "Wait 2 days", durationValue: 2, durationUnit: "days" } },
    { node_key: "cond_paid_1", type: "condition", position: pos(780, 0), config: { title: "Paid now?", check: "is_paid" } },
    { node_key: "goal_paid", type: "goal", position: pos(1040, -140), config: { title: "Installment paid", goalType: "payment_completed" } },
    smsNode("sms_final", "Final reminder", "payment_reminder", final, idMap(final), pos(1040, 140), "installment_final_reminder"),
    { node_key: "wait_2d_b", type: "wait", position: pos(1300, 140), config: { title: "Wait 2 days", durationValue: 2, durationUnit: "days" } },
    { node_key: "cond_paid_2", type: "condition", position: pos(1560, 140), config: { title: "Paid now?", check: "is_paid" } },
    { node_key: "task_accounts", type: "staff_task", position: pos(1820, 220), config: { title: "Accounts follow-up call", assignee: "Accounts team", details: "Installment still overdue after two reminders — personal follow-up." } },
    { node_key: "exit_end", type: "exit", position: pos(2080, 220), config: { title: "Exit" } },
  ];
  const edges = [
    edge("trigger_overdue", "sms_overdue"),
    edge("sms_overdue", "wait_2d_a"),
    edge("wait_2d_a", "cond_paid_1"),
    edge("cond_paid_1", "goal_paid", "yes"),
    edge("cond_paid_1", "sms_final", "no"),
    edge("sms_final", "wait_2d_b"),
    edge("wait_2d_b", "cond_paid_2"),
    edge("cond_paid_2", "goal_paid", "yes"),
    edge("cond_paid_2", "task_accounts", "no"),
    edge("task_accounts", "exit_end"),
  ];
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// 3. Payment Thank-You & Activation — trigger payment_received, goal logged_in.
//    Instant thank-you (approved template) then drive first portal login.
// ---------------------------------------------------------------------------
function buildPaymentThankYou(byKey: Map<string, AutomationTemplateOption>): BuilderGraph {
  const thankyou = byKey.get("payment_successful");
  // Not-logged-in reminder → welcome_first_login (login url + code = portal access).
  const portal = byKey.get("welcome_first_login");
  const nodes: BuilderNode[] = [
    { node_key: "trigger_pay", type: "trigger", position: pos(0, 0), config: { title: "Payment received", eventType: "payment_received" } },
    smsNode("sms_thankyou", "Payment thank-you + login", "transactional", thankyou, idMap(thankyou), pos(260, 0)),
    { node_key: "wait_1d", type: "wait", position: pos(520, 0), config: { title: "Wait 1 day", durationValue: 1, durationUnit: "days" } },
    { node_key: "cond_login_1", type: "condition", position: pos(780, 0), config: { title: "Has logged in?", check: "has_logged_in" } },
    { node_key: "goal_login", type: "goal", position: pos(1040, -140), config: { title: "Activated (logged in)", goalType: "logged_in" } },
    smsNode("sms_portal", "Portal access reminder", "transactional", portal, idMap(portal), pos(1040, 140), "portal_login_reminder"),
    { node_key: "wait_2d", type: "wait", position: pos(1300, 140), config: { title: "Wait 2 days", durationValue: 2, durationUnit: "days" } },
    { node_key: "cond_login_2", type: "condition", position: pos(1560, 140), config: { title: "Has logged in?", check: "has_logged_in" } },
    { node_key: "task_onboard", type: "staff_task", position: pos(1820, 220), config: { title: "Onboarding call", assignee: "Counselling team", details: "Paid student has not logged in — welcome + onboarding call." } },
    { node_key: "exit_end", type: "exit", position: pos(2080, 220), config: { title: "Exit" } },
  ];
  const edges = [
    edge("trigger_pay", "sms_thankyou"),
    edge("sms_thankyou", "wait_1d"),
    edge("wait_1d", "cond_login_1"),
    edge("cond_login_1", "goal_login", "yes"),
    edge("cond_login_1", "sms_portal", "no"),
    edge("sms_portal", "wait_2d"),
    edge("wait_2d", "cond_login_2"),
    edge("cond_login_2", "goal_login", "yes"),
    edge("cond_login_2", "task_onboard", "no"),
    edge("task_onboard", "exit_end"),
  ];
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// 4. Webinar Onboarding & Attendance — trigger webinar_registered, goal logged_in.
//    Confirm (approved) -> how-to-join tutorial -> day-of nudge; login is our
//    best available attendance proxy (no attendance signal is captured yet).
// ---------------------------------------------------------------------------
function buildWebinarOnboarding(byKey: Map<string, AutomationTemplateOption>): BuilderGraph {
  const confirm = byKey.get("webinar_registered");
  // Closest approved joining templates:
  //   join  → zoom_ready ("joining details are ready, log in to join")
  //   dayof → starting_soon_1hr ("your webinar starts in 1 hour, log in to join")
  const join = byKey.get("zoom_ready");
  const dayof = byKey.get("starting_soon_1hr");
  const nodes: BuilderNode[] = [
    { node_key: "trigger_reg", type: "trigger", position: pos(0, 0), config: { title: "Webinar registered", eventType: "webinar_registered" } },
    smsNode("sms_confirm", "Registration confirmed", "transactional", confirm, idMap(confirm), pos(260, 0)),
    { node_key: "wait_1d", type: "wait", position: pos(520, 0), config: { title: "Wait 1 day", durationValue: 1, durationUnit: "days" } },
    smsNode("sms_join", "How to join tutorial", "transactional", join, idMap(join), pos(780, 0), "webinar_join_tutorial"),
    { node_key: "wait_1d_b", type: "wait", position: pos(1040, 0), config: { title: "Wait 1 day", durationValue: 1, durationUnit: "days" } },
    { node_key: "cond_login", type: "condition", position: pos(1300, 0), config: { title: "Has logged in?", check: "has_logged_in" } },
    { node_key: "goal_login", type: "goal", position: pos(1560, -140), config: { title: "Engaged (logged in)", goalType: "logged_in" } },
    smsNode("sms_dayof", "Day-of reminder", "transactional", dayof, idMap(dayof), pos(1560, 140), "webinar_day_of_reminder"),
    { node_key: "exit_end", type: "exit", position: pos(1820, 140), config: { title: "Exit" } },
  ];
  const edges = [
    edge("trigger_reg", "sms_confirm"),
    edge("sms_confirm", "wait_1d"),
    edge("wait_1d", "sms_join"),
    edge("sms_join", "wait_1d_b"),
    edge("wait_1d_b", "cond_login"),
    edge("cond_login", "goal_login", "yes"),
    edge("cond_login", "sms_dayof", "no"),
    edge("sms_dayof", "exit_end"),
  ];
  return { nodes, edges };
}

/** All journeys built here (New Lead Onboarding is seeded separately). */
export const JOURNEY_DEFS: JourneyDef[] = [
  { name: "Installment Reminders", description: "Overdue installment dunning; auto-stops the instant the student pays.", build: (b) => buildInstallmentReminders(b) },
  { name: "Payment Thank-You & Activation", description: "Instant thank-you after payment, then drive the first portal login.", build: (b) => buildPaymentThankYou(b) },
  { name: "Webinar Onboarding & Attendance", description: "Confirm registration, teach how to join, and nudge day-of.", build: (b) => buildWebinarOnboarding(b) },
];

export interface SeedJourneyResult {
  name: string;
  created: boolean;
  workflowId: string | null;
  pendingTemplateKeys: string[];
}

function pendingKeys(graph: BuilderGraph): string[] {
  return graph.nodes
    .filter((n) => n.type === "send_sms" && !n.config?.["automationTemplateId"] && n.config?.["pendingTemplateKey"])
    .map((n) => String(n.config?.["pendingTemplateKey"]));
}

/** Create each journey draft if it doesn't already exist. Idempotent by name. */
export async function seedJourneySet(actor: KillSwitchActor): Promise<SeedJourneyResult[]> {
  const [existing, templates] = await Promise.all([listWorkflows(), listTemplateOptions()]);
  const byKey = new Map(templates.map((t) => [t.sms_template_id, t]));

  const results: SeedJourneyResult[] = [];
  for (const def of JOURNEY_DEFS) {
    const graph = def.build(byKey);
    const pk = pendingKeys(graph);
    const wf = existing.find((w) => w.name === def.name);
    if (wf) {
      // Converge the existing DRAFT to the current design so template rebindings
      // take effect (safe: draft-only write, never publishes). Only while draft.
      if (wf.status === "draft") {
        await saveDraftGraph(wf.id, graph, actor, `Re-synced "${def.name}" draft graph (execution off)`);
      }
      results.push({ name: def.name, created: false, workflowId: wf.id, pendingTemplateKeys: pk });
      continue;
    }
    const created = await createWorkflow(def.name, actor);
    await saveDraftGraph(created.id, graph, actor, `Seeded "${def.name}" journey (draft; execution off)`);
    results.push({ name: def.name, created: true, workflowId: created.id, pendingTemplateKeys: pk });
  }
  return results;
}
