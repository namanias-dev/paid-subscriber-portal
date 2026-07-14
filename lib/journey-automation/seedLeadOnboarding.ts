/**
 * Seed the first real workflow — "New Lead Onboarding" — as a ready DRAFT.
 *
 * SAFETY: this only writes AUTHORING intent (a draft graph). It never publishes,
 * never enables execution, never flips a flag, and never sends. execution_mode
 * stays 'off' (the default), so nothing enrolls or runs. The graph is designed to
 * pass validation except for ONE deliberate placeholder SMS step (a message with
 * no approved DLT template yet), which validation flags as "select an approved
 * template" — exactly as intended.
 *
 * Idempotent: re-running is a no-op once a workflow named SEED_NAME exists.
 */
import type { BuilderGraph, AutomationTemplateOption } from "@/types/journey-automation";
import type { KillSwitchActor } from "./store";
import { listWorkflows } from "./store";
import { createWorkflow, saveDraftGraph, listTemplateOptions } from "./builderStore";

export const SEED_NAME = "New Lead Onboarding";

/** Preferred approved templates for each SMS step (by sms_templates id). */
export const SEED_TEMPLATE_REFS = {
  welcome: "welcome_first_login",
  webinarInvite: "general_webinar_invite",
} as const;

function pos(x: number, y: number) { return { x, y }; }

export function smsNode(
  key: string,
  title: string,
  category: string,
  opt: AutomationTemplateOption | undefined,
  mapping: Record<string, string>,
  position: { x: number; y: number },
  pendingKey?: string,
) {
  if (!opt) {
    // Placeholder: no approved template yet. Validation + inspector flag this
    // clearly ("pending DLT approval: <key>"). The journey stays a safe draft.
    return {
      node_key: key,
      type: "send_sms",
      position,
      config: { title, category, automationTemplateId: null, pendingTemplateKey: pendingKey ?? null, quietHours: { start: "21:00", end: "08:00" }, frequencyCap: { perDays: 1, max: 1 }, variableMapping: {} },
    };
  }
  return {
    node_key: key,
    type: "send_sms",
    position,
    config: {
      title, category,
      automationTemplateId: opt.id,
      sms_template_id: opt.sms_template_id,
      templateName: opt.name,
      templateVariables: opt.variables,
      body: opt.body,
      variableMapping: mapping,
      quietHours: { start: "21:00", end: "08:00" },
      frequencyCap: { perDays: 1, max: 1 },
    },
  };
}

/**
 * Build the lead-onboarding draft graph from the available approved templates.
 * PURE (no I/O) so it can be unit-tested and validated.
 */
export function buildLeadOnboardingGraph(templates: AutomationTemplateOption[]): BuilderGraph {
  const bySms = new Map(templates.map((t) => [t.sms_template_id, t]));
  const welcome = bySms.get(SEED_TEMPLATE_REFS.welcome);
  const invite = bySms.get(SEED_TEMPLATE_REFS.webinarInvite);

  const welcomeMap = (t?: AutomationTemplateOption): Record<string, string> => {
    const m: Record<string, string> = {};
    for (const v of t?.variables ?? []) m[v] = v; // identity map (first_name, login_url, login_code)
    return m;
  };

  const nodes = [
    { node_key: "trigger_lead", type: "trigger", position: pos(0, 0), config: { title: "New lead registered", eventType: "lead_created" } },
    smsNode("sms_welcome", "Welcome + login SMS", "transactional", welcome, welcomeMap(welcome), pos(260, 0)),
    { node_key: "wait_day1", type: "wait", position: pos(520, 0), config: { title: "Wait 1 day", durationValue: 1, durationUnit: "days" } },
    { node_key: "cond_login", type: "condition", position: pos(780, 0), config: { title: "Has logged in?", check: "has_logged_in" } },
    smsNode("sms_beginner", "Beginner resources", "transactional", undefined, {}, pos(1040, -140), "beginner_resources"),
    smsNode("sms_portal", "Portal access reminder", "transactional", undefined, {}, pos(1040, 140), "portal_login_reminder"),
    { node_key: "wait_day2", type: "wait", position: pos(1300, 0), config: { title: "Wait 2 days", durationValue: 2, durationUnit: "days" } },
    { node_key: "cond_webinar", type: "condition", position: pos(1560, 0), config: { title: "Registered for a webinar?", check: "registered_for_webinar" } },
    { node_key: "goal_converted", type: "goal", position: pos(1820, -140), config: { title: "Converted (logged in or registered)", goalType: "logged_in" } },
    smsNode("sms_invite", "Invite to best active webinar", "promotional", invite, welcomeMap(invite), pos(1820, 140)),
    { node_key: "task_followup", type: "staff_task", position: pos(2080, 140), config: { title: "Call high-intent lead", assignee: "Counselling team", details: "Lead engaged but did not convert — personal follow-up." } },
    { node_key: "exit_end", type: "exit", position: pos(2340, 140), config: { title: "Exit" } },
  ];

  const edge = (source: string, target: string, branch_label: string | null = null) => ({ edge_key: `${source}__${target}`, source, target, branch_label, condition: {} });
  const edges = [
    edge("trigger_lead", "sms_welcome"),
    edge("sms_welcome", "wait_day1"),
    edge("wait_day1", "cond_login"),
    edge("cond_login", "sms_beginner", "yes"),
    edge("cond_login", "sms_portal", "no"),
    edge("sms_beginner", "wait_day2"),
    edge("sms_portal", "wait_day2"),
    edge("wait_day2", "cond_webinar"),
    edge("cond_webinar", "goal_converted", "yes"),
    edge("cond_webinar", "sms_invite", "no"),
    edge("sms_invite", "task_followup"),
    edge("task_followup", "exit_end"),
  ];

  return { nodes, edges };
}

export interface SeedResult {
  created: boolean;
  workflowId: string | null;
  usedTemplates: { welcome: boolean; webinarInvite: boolean };
  placeholderSteps: string[];
}

/** Create the seed workflow if it doesn't already exist. Idempotent by name. */
export async function seedLeadOnboarding(actor: KillSwitchActor): Promise<SeedResult> {
  const existing = (await listWorkflows()).find((w) => w.name === SEED_NAME);
  const templates = await listTemplateOptions();
  const graph = buildLeadOnboardingGraph(templates);
  const placeholderSteps = graph.nodes
    .filter((n) => n.type === "send_sms" && !n.config?.["automationTemplateId"])
    .map((n) => String(n.config?.["title"] ?? n.node_key));
  const usedTemplates = {
    welcome: templates.some((t) => t.sms_template_id === SEED_TEMPLATE_REFS.welcome),
    webinarInvite: templates.some((t) => t.sms_template_id === SEED_TEMPLATE_REFS.webinarInvite),
  };

  if (existing) {
    // Converge the existing DRAFT to the current design (safe: draft-only write,
    // never publishes). Only re-saves while still a draft so we never clobber a
    // published/live version.
    if (existing.status === "draft") {
      await saveDraftGraph(existing.id, graph, actor, "Re-synced New Lead Onboarding draft graph (execution off)");
    }
    return { created: false, workflowId: existing.id, usedTemplates, placeholderSteps };
  }

  const wf = await createWorkflow(SEED_NAME, actor);
  await saveDraftGraph(wf.id, graph, actor, "Seeded New Lead Onboarding journey (draft; execution off)");
  return { created: true, workflowId: wf.id, usedTemplates, placeholderSteps };
}
