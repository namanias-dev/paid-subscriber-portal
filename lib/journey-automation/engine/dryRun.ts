/**
 * DRY-RUN REPORT — the human-reviewed artifact before flipping a workflow live.
 *
 * Given a workflow's IMMUTABLE published graph and its REAL recent event stream, it
 * projects: eligible / excluded (by reason) / branch distribution / and the EXACT
 * messages that WOULD send. It performs ZERO sends and ZERO writes (pure read-only
 * projection); waits are collapsed to pass-through so the full path is walked.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseGraph, triggerNode, nodeByKey, nextNodeKeys, goalNode, entryNodeKey } from "./graph";
import { checkEligibility, canaryAllows, type EligibilityReason } from "./eligibility";
import { evaluateCondition, shouldSuppressReminder, evaluateGoal } from "./latestState";
import { sendDecision, type SendCategory } from "./mode";
import { sendIdempotencyKey } from "./keys";
import { realState } from "./realState";
import type { WorkflowRuntimeRow, EnrollmentRow } from "./types";
import type { AutomationEvent, BuilderGraph, BuilderNode } from "@/types/journey-automation";

export interface DryRunSend {
  phoneMasked: string;
  templateId: string;
  category: string;
  nodeKey: string;
  variables: Record<string, unknown>;
  idempotencyKey: string;
  wouldSendLive: boolean;
  decisionReason: string;
}

export interface DryRunReport {
  workflowId: string;
  workflowName: string;
  executionMode: string;
  triggerEventType: string | null;
  sampledEvents: number;
  eligible: number;
  excluded: Record<EligibilityReason, number>;
  suppressed: number;
  branchDistribution: Record<string, { yes: number; no: number }>;
  goalsProjected: number;
  wouldSend: DryRunSend[];
  actualSends: 0;
  generatedAt: string;
}

function maskPhone(p: string | null): string {
  if (!p) return "—";
  return p.length >= 10 ? `${p.slice(0, 2)}****${p.slice(-2)}` : "****";
}

const SECRET_KEY = /(login|otp|code|password|secret|token|payment_link|link|url)/i;

function resolvePublicVars(node: BuilderNode, context: Record<string, unknown>): Record<string, unknown> {
  const cfg = node.config ?? {};
  const statics = (cfg["variables"] as Record<string, unknown>) ?? {};
  const out: Record<string, unknown> = {};
  const bag: Record<string, unknown> = { ...context };
  const mapping = (cfg["variableMapping"] as Record<string, string>) ?? {};
  for (const [k, path] of Object.entries(mapping)) if (!SECRET_KEY.test(k)) out[k] = bag[path] ?? null;
  for (const [k, v] of Object.entries(statics)) if (!SECRET_KEY.test(k)) out[k] = v;
  return out;
}

const EMPTY_EXCLUDED: Record<EligibilityReason, number> = {
  ok: 0, invalid_phone: 0, opted_out: 0, staff_or_test: 0,
  already_enrolled: 0, already_converted: 0, canary_excluded: 0,
};

export async function dryRunWorkflow(workflowId: string, sampleLimit = 500): Promise<DryRunReport> {
  const sb = getSupabaseAdmin();
  const nowISO = new Date().toISOString();
  const report: DryRunReport = {
    workflowId, workflowName: "", executionMode: "off", triggerEventType: null,
    sampledEvents: 0, eligible: 0, excluded: { ...EMPTY_EXCLUDED }, suppressed: 0,
    branchDistribution: {}, goalsProjected: 0, wouldSend: [], actualSends: 0, generatedAt: nowISO,
  };
  if (!sb) return report;

  const { data: wf } = await sb.from("automation_workflows").select("*").eq("id", workflowId).maybeSingle();
  if (!wf) return report;
  const workflow = wf as WorkflowRuntimeRow;
  report.workflowName = workflow.name;
  report.executionMode = workflow.execution_mode;

  const { data: ver } = await sb.from("automation_workflow_versions").select("id, definition")
    .eq("workflow_id", workflowId).eq("status", "published").order("version", { ascending: false }).limit(1).maybeSingle();
  if (!ver) return report;
  const graph: BuilderGraph = parseGraph((ver as { definition: unknown }).definition);
  const versionId = (ver as { id: string }).id;

  const trig = triggerNode(graph);
  const eventType = (trig?.config?.["eventType"] ?? trig?.config?.["event_type"]) as string | undefined;
  report.triggerEventType = eventType ?? null;
  if (!eventType) return report;

  const { data: events } = await sb.from("automation_events").select("*")
    .eq("event_type", eventType).order("occurred_at", { ascending: false }).limit(sampleLimit);
  const sample = (events ?? []) as AutomationEvent[];
  report.sampledEvents = sample.length;

  // existing active enrollments (to project already_enrolled)
  const { data: activeEnr } = await sb.from("automation_enrollments").select("normalized_phone")
    .eq("workflow_id", workflowId).eq("status", "active");
  const activePhones = new Set((activeEnr ?? []).map((r) => (r as { normalized_phone: string | null }).normalized_phone).filter(Boolean));
  const goalType = (goalNode(graph)?.config?.["goal_type"] ?? goalNode(graph)?.config?.["goalType"]) as string | null;

  let projectedActive = activePhones.size;
  const seen = new Set<string>();

  for (const ev of sample) {
    const facts = await realState.getEligibilityFacts(workflow, ev);
    const phone = facts.normalizedPhone;
    // dedupe within the sample (latest event per phone already ordered desc)
    if (phone && seen.has(phone)) continue;
    if (phone) seen.add(phone);

    const alreadyEnrolled = !!phone && activePhones.has(phone);
    const canaryAllowed = canaryAllows(phone, projectedActive, workflow.canary_max_enrollments, workflow.canary_test_phones);
    const elig = checkEligibility({ ...facts, alreadyEnrolledActive: alreadyEnrolled, canaryAllowed });
    if (!elig.eligible) { report.excluded[elig.reason]++; continue; }
    report.eligible++;
    projectedActive++;

    // Walk the graph with LATEST state (waits collapsed) to project sends + branches.
    const synthetic: EnrollmentRow = {
      id: `dryrun:${ev.id}`, workflow_id: workflowId, version_id: versionId, event_id: ev.id,
      normalized_phone: phone, student_id: ev.student_id, lead_id: ev.lead_id, enrollment_ref: ev.enrollment_id,
      mode: workflow.execution_mode === "live" ? "live" : "simulate", status: "active",
      current_node_key: entryNodeKey(graph), context: { ...(ev.payload ?? {}), event_type: ev.event_type, payload: ev.payload ?? {}, webinar_id: ev.webinar_id ?? null, payment_id: ev.payment_id ?? null },
      goal_met: false, exit_reason: null, dedupe_key: null, enrolled_at: nowISO, updated_at: nowISO, completed_at: null,
    };
    const latest = await realState.getLatestState(synthetic);

    if (evaluateGoal(goalType, latest) || latest.optedOut) { report.goalsProjected++; continue; }

    let cursor: string | null = entryNodeKey(graph);
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      const node = nodeByKey(graph, cursor);
      if (!node) break;
      if (node.type === "goal") { report.goalsProjected++; break; }
      if (node.type === "exit") break;
      if (node.type === "condition") {
        const result = evaluateCondition(node.config ?? {}, latest);
        const dist = report.branchDistribution[cursor] ?? { yes: 0, no: 0 };
        if (result) dist.yes++; else dist.no++;
        report.branchDistribution[cursor] = dist;
        cursor = nextNodeKeys(graph, cursor, result ? "yes" : "no")[0] ?? null;
        continue;
      }
      if (node.type === "send_sms") {
        const category = (typeof node.config?.["category"] === "string" ? node.config["category"] : "transactional") as SendCategory;
        const supp = shouldSuppressReminder(category, latest);
        if (supp.suppress) { report.suppressed++; cursor = nextNodeKeys(graph, cursor)[0] ?? null; continue; }
        const decision = sendDecision({ enrollmentMode: synthetic.mode, killSwitchEngaged: false, category });
        report.wouldSend.push({
          phoneMasked: maskPhone(phone),
          templateId: String(node.config?.["templateId"] ?? node.config?.["sms_template_id"] ?? ""),
          category, nodeKey: cursor, variables: resolvePublicVars(node, synthetic.context),
          idempotencyKey: sendIdempotencyKey(synthetic.id, cursor),
          wouldSendLive: decision.live, decisionReason: decision.reason,
        });
        cursor = nextNodeKeys(graph, cursor)[0] ?? null;
        continue;
      }
      // trigger / wait / branch / staff_task => pass through
      cursor = nextNodeKeys(graph, cursor)[0] ?? null;
    }
  }

  return report;
}
