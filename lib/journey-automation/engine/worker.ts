/**
 * NODE-EXECUTION WORKER (pure orchestrator over ports). Claims due jobs (atomic
 * SKIP LOCKED in the real port) and executes one node per job with LATEST-STATE
 * REVALIDATION before EVERY node.
 *
 * Safety guarantees:
 *  - Kill switch => halts immediately (claims nothing, sends nothing).
 *  - Before any node: re-derive current business truth. Goal met or disqualified
 *    (paid / enrolled / opted-out) => cancel ALL pending jobs, record, exit. This is
 *    exactly how "please pay" stops the instant the student pays.
 *  - SMS goes only through the adapter (simulate by default; live only via SenderPort).
 *  - Idempotent: a node already run (crash/retry) is not re-executed; sends carry a
 *    deterministic dedupe key so the chokepoint can never double-send.
 *  - Retry with exponential backoff; dead-letter after max attempts; stale 'running'
 *    jobs are re-queued (crash recovery).
 */
import type { EngineDataPort, SenderPort, StatePort, Clock, EngineSettings } from "./ports";
import { systemClock } from "./ports";
import type { EnrollmentRow, JobRow, EnrollmentStatus } from "./types";
import type { BuilderGraph, BuilderNode } from "@/types/journey-automation";
import { nodeByKey, nextNodeKeys, goalNode } from "./graph";
import { evaluateGoal, isDisqualified, shouldSuppressReminder, evaluateCondition, type LatestState } from "./latestState";
import { runSmsAction } from "./smsAdapter";
import type { SendCategory } from "./mode";
import { jobDedupeKey } from "./keys";
import { backoffMs, isExhausted } from "./backoff";
import type { GuardContext } from "../guards";

export interface WorkerResult {
  halted?: string;
  requeued: number;
  claimed: number;
  executed: number;
  simulated: number;
  sent: number;
  suppressed: number;
  goals: number;
  cancelled: number;
  failed: number;
  deadLettered: number;
}

export interface WorkerOptions {
  batchSize?: number;
  staleJobMs?: number;
  guardOverrides?: Pick<GuardContext, "executionEnabled" | "smsEnabled" | "promotionalEnabled">;
  paymentRemindersEnabled?: boolean;
}

const DONE_NODE_STATUSES = new Set(["done", "sent", "simulated", "suppressed", "skipped"]);
const WAIT_DEFAULT_MS = 24 * 60 * 60_000;

function workflowGoalType(g: BuilderGraph): string | null {
  const gn = goalNode(g);
  const t = gn?.config?.["goal_type"] ?? gn?.config?.["goalType"];
  return typeof t === "string" ? t : null;
}

/** Timezone-aware wait duration (ms) from node config. Supports ms / minutes / hours / days. */
export function waitMsFromConfig(config: Record<string, unknown>, now: number): number {
  const c = config ?? {};
  if (typeof c["wait_ms"] === "number") return Math.max(0, c["wait_ms"] as number);
  const n = Number(c["duration"] ?? c["value"] ?? c["durationValue"] ?? 0);
  const unit = String(c["unit"] ?? c["durationUnit"] ?? "days");
  if (Number.isFinite(n) && n > 0) {
    const mult = unit === "minutes" ? 60_000 : unit === "hours" ? 3_600_000 : unit === "days" ? 86_400_000 : 86_400_000;
    return n * mult;
  }
  // wait-until an absolute IST datetime
  const until = c["until"];
  if (typeof until === "string") {
    const t = new Date(until).getTime();
    if (Number.isFinite(t)) return Math.max(0, t - now);
  }
  return WAIT_DEFAULT_MS;
}

/** Stable 32-bit hash (FNV-1a) for deterministic bucketing. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface BranchOption { label: string; weight: number }

/** Normalize a branch node's config into weighted options. */
export function branchOptions(config: Record<string, unknown>): BranchOption[] {
  const raw = config?.["branches"];
  if (Array.isArray(raw)) {
    const opts = raw
      .map((b) => {
        if (typeof b === "string") return { label: b, weight: 1 };
        const o = (b ?? {}) as Record<string, unknown>;
        const label = String(o["label"] ?? "").trim();
        const weight = Math.max(0, Number(o["weight"] ?? 1) || 0);
        return label ? { label, weight } : null;
      })
      .filter((b): b is BranchOption => b !== null && b.weight > 0);
    if (opts.length) return opts;
  }
  return [{ label: "A", weight: 1 }];
}

/** Deterministic weighted choice of a branch label from an enrollment seed. */
export function pickBranch(config: Record<string, unknown>, seed: string): string {
  const opts = branchOptions(config);
  const total = opts.reduce((s, o) => s + o.weight, 0);
  if (total <= 0) return opts[0].label;
  const point = (hash32(seed) % 10_000) / 10_000 * total;
  let acc = 0;
  for (const o of opts) {
    acc += o.weight;
    if (point < acc) return o.label;
  }
  return opts[opts.length - 1].label;
}

const SECRET_KEY = /(login|otp|code|password|secret|token|payment_link|link|url)/i;

function resolveVariables(
  node: BuilderNode,
  enrollment: EnrollmentRow,
): { publicVariables: Record<string, string | number | null>; secretVariables: Record<string, string | number | null> } {
  const cfg = node.config ?? {};
  const statics = (cfg["variables"] as Record<string, unknown>) ?? {};
  const publicVariables: Record<string, string | number | null> = {};
  const secretVariables: Record<string, string | number | null> = {};
  const bag: Record<string, unknown> = { ...(enrollment.context ?? {}), phone: enrollment.normalized_phone };
  const mapping = (cfg["variableMapping"] as Record<string, string>) ?? {};
  for (const [key, path] of Object.entries(mapping)) {
    const v = bag[path];
    const val = (typeof v === "string" || typeof v === "number") ? v : null;
    if (SECRET_KEY.test(key)) secretVariables[key] = val; else publicVariables[key] = val;
  }
  for (const [key, v] of Object.entries(statics)) {
    const val = (typeof v === "string" || typeof v === "number") ? v : null;
    // secret-named statics are treated as transient placeholders (resolved live later)
    if (SECRET_KEY.test(key)) secretVariables[key] = val; else publicVariables[key] = val;
  }
  return { publicVariables, secretVariables };
}

export async function runWorker(
  data: EngineDataPort,
  sender: SenderPort,
  state: StatePort,
  clock: Clock = systemClock,
  opts: WorkerOptions = {},
): Promise<WorkerResult> {
  const res: WorkerResult = {
    requeued: 0, claimed: 0, executed: 0, simulated: 0, sent: 0,
    suppressed: 0, goals: 0, cancelled: 0, failed: 0, deadLettered: 0,
  };

  const settings = await data.getSettings();
  if (settings.killSwitchEngaged) return { ...res, halted: "kill_switch" };

  res.requeued = await data.requeueStaleJobs(opts.staleJobMs ?? 10 * 60_000);

  const jobs = await data.claimJobs(opts.batchSize ?? 25);
  res.claimed = jobs.length;

  for (const job of jobs) {
    try {
      await executeJob(data, sender, state, clock, settings, opts, job, res);
      res.executed++;
    } catch (err) {
      await handleFailure(data, clock, job, err, res);
    }
  }
  return res;
}

async function stopEnrollment(
  data: EngineDataPort,
  clock: Clock,
  enr: EnrollmentRow,
  status: EnrollmentStatus,
  reason: string,
  res: WorkerResult,
): Promise<void> {
  const cancelled = await data.cancelPendingJobs(enr.id);
  res.cancelled += cancelled;
  await data.updateEnrollment(enr.id, {
    status,
    exit_reason: reason,
    goal_met: status === "goal_met",
    completed_at: new Date(clock.now()).toISOString(),
  });
}

async function scheduleNext(
  data: EngineDataPort,
  clock: Clock,
  enr: EnrollmentRow,
  graph: BuilderGraph,
  fromKey: string,
  branch: string | null,
  atMs: number,
  res: WorkerResult,
): Promise<void> {
  const nextKeys = nextNodeKeys(graph, fromKey, branch);
  if (nextKeys.length === 0) {
    await stopEnrollment(data, clock, enr, "completed", "end_of_graph", res);
    return;
  }
  const whenISO = new Date(atMs).toISOString();
  for (const key of nextKeys) {
    await data.scheduleJob({
      enrollment_id: enr.id,
      workflow_id: enr.workflow_id,
      node_key: key,
      scheduled_for: whenISO,
      dedupe_key: jobDedupeKey(enr.id, key),
    });
  }
  await data.updateEnrollment(enr.id, { current_node_key: nextKeys[0] });
}

async function executeJob(
  data: EngineDataPort,
  sender: SenderPort,
  state: StatePort,
  clock: Clock,
  settings: EngineSettings,
  opts: WorkerOptions,
  job: JobRow,
  res: WorkerResult,
): Promise<void> {
  const enr = await data.getEnrollment(job.enrollment_id);
  if (!enr) { await data.completeJob(job.id, "done"); return; }
  if (enr.status !== "active") { await data.completeJob(job.id, "cancelled"); return; }

  const graph = await data.getPublishedGraph(enr.version_id);
  if (!graph) { await data.completeJob(job.id, "done"); return; }
  const node = nodeByKey(graph, job.node_key);
  if (!node) { await data.completeJob(job.id, "done"); return; }

  // --- LATEST-STATE REVALIDATION (before EVERY node) ---
  const latest = await state.getLatestState(enr);
  const goalType = workflowGoalType(graph);

  const dq = isDisqualified(latest);
  if (dq.disqualified) {
    await data.recordSuppression({
      enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key,
      normalized_phone: enr.normalized_phone, reason: `disqualified:${dq.reason}`,
    });
    await stopEnrollment(data, clock, enr, "cancelled", dq.reason ?? "disqualified", res);
    await data.completeJob(job.id, "done");
    return;
  }
  if (evaluateGoal(goalType, latest)) {
    await data.recordGoal({
      enrollment_id: enr.id, workflow_id: enr.workflow_id,
      goal_node_key: goalNode(graph)?.node_key ?? null, goal_type: goalType,
      attributed_event: (enr.context?.["event_type"] as string) ?? null, mode: enr.mode,
    });
    res.goals++;
    await stopEnrollment(data, clock, enr, "goal_met", "goal_met", res);
    await data.completeJob(job.id, "done");
    return;
  }

  // --- IDEMPOTENT execution (crash/retry-safe): already-run node just advances ---
  const existing = await data.getNodeRun(enr.id, node.node_key);
  if (existing && DONE_NODE_STATUSES.has(existing.status)) {
    await scheduleNext(data, clock, enr, graph, node.node_key, null, clock.now(), res);
    await data.completeJob(job.id, "done");
    return;
  }

  const now = clock.now();

  switch (node.type) {
    case "trigger": {
      await data.upsertNodeRun({ enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key, node_type: "trigger", status: "done", mode: enr.mode });
      await scheduleNext(data, clock, enr, graph, node.node_key, null, now, res);
      break;
    }
    case "wait": {
      const delay = waitMsFromConfig(node.config ?? {}, now);
      await data.upsertNodeRun({ enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key, node_type: "wait", status: "done", mode: enr.mode, outcome: { waited_ms: delay } });
      await scheduleNext(data, clock, enr, graph, node.node_key, null, now + delay, res);
      break;
    }
    case "condition": {
      const result = evaluateCondition(node.config ?? {}, latest);
      await data.upsertNodeRun({ enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key, node_type: "condition", status: "done", mode: enr.mode, outcome: { result } });
      await scheduleNext(data, clock, enr, graph, node.node_key, result ? "yes" : "no", now, res);
      break;
    }
    case "branch": {
      // Deterministic weighted split (A/B/n experiment). The bucket is a pure
      // function of the enrollment id, so re-runs after a crash pick the SAME
      // path (idempotent) and the split is reproducible in dry-run.
      const label = pickBranch(node.config ?? {}, enr.id);
      await data.upsertNodeRun({ enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key, node_type: "branch", status: "done", mode: enr.mode, outcome: { branch: label } });
      await scheduleNext(data, clock, enr, graph, node.node_key, label, now, res);
      break;
    }
    case "goal": {
      await data.recordGoal({
        enrollment_id: enr.id, workflow_id: enr.workflow_id, goal_node_key: node.node_key,
        goal_type: goalType, attributed_event: (enr.context?.["event_type"] as string) ?? null, mode: enr.mode,
      });
      res.goals++;
      await data.upsertNodeRun({ enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key, node_type: "goal", status: "done", mode: enr.mode });
      await stopEnrollment(data, clock, enr, "goal_met", "goal_met", res);
      break;
    }
    case "send_sms": {
      const category = (typeof node.config?.["category"] === "string" ? node.config["category"] : "transactional") as SendCategory;

      // per-category pause
      if (settings.pausedCategories.includes(category)) {
        await data.recordSuppression({ enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key, normalized_phone: enr.normalized_phone, reason: `category_paused:${category}` });
        await data.upsertNodeRun({ enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key, node_type: "send_sms", status: "suppressed", mode: enr.mode, outcome: { reason: "category_paused" } });
        res.suppressed++;
        await scheduleNext(data, clock, enr, graph, node.node_key, null, now, res);
        break;
      }

      // latest-state suppression (paid / no-overdue / paused / waived / opted-out)
      const supp = shouldSuppressReminder(category, latest);
      if (supp.suppress) {
        await data.recordSuppression({ enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key, normalized_phone: enr.normalized_phone, reason: `latest_state:${supp.reason}` });
        await data.upsertNodeRun({ enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key, node_type: "send_sms", status: "suppressed", mode: enr.mode, outcome: { reason: supp.reason } });
        res.suppressed++;
        await scheduleNext(data, clock, enr, graph, node.node_key, null, now, res);
        break;
      }

      const templateId = String(node.config?.["templateId"] ?? node.config?.["sms_template_id"] ?? "");
      const { publicVariables, secretVariables } = resolveVariables(node, enr);
      const action = await runSmsAction(sender, {
        enrollment: enr, nodeKey: node.node_key, category,
        recipient: enr.normalized_phone ?? "", templateId,
        publicVariables, secretVariables,
        relatedEntity: { user_id: enr.student_id, lead_id: enr.lead_id, student_name: null },
        triggerEvent: `journey:${enr.workflow_id}`, audienceType: category,
        killSwitchEngaged: settings.killSwitchEngaged,
        guardOverrides: opts.guardOverrides,
        paymentRemindersEnabled: opts.paymentRemindersEnabled,
      });

      await data.upsertNodeRun({
        enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key, node_type: "send_sms",
        status: action.status, mode: action.mode, resolved_variables: action.resolvedVariables,
        outcome: action.outcome, idempotency_key: action.idempotencyKey,
        error: action.status === "failed" ? String(action.outcome?.["error"] ?? "send_failed") : null,
      });

      if (action.status === "simulated") res.simulated++;
      else if (action.status === "sent") res.sent++;

      if (action.status === "failed") {
        // bubble up to retry/backoff (provider failure)
        throw new Error(String(action.outcome?.["error"] ?? "send_failed"));
      }
      await scheduleNext(data, clock, enr, graph, node.node_key, null, now, res);
      break;
    }
    case "staff_task": {
      // Create-task-only (NO business mutation, NO send). Writes a journey-owned
      // staff-task record for a human; idempotent per (enrollment,node).
      const title = String(node.config?.["title"] ?? "Journey follow-up task");
      const assignee = typeof node.config?.["assignee"] === "string" ? (node.config["assignee"] as string) : null;
      await data.createStaffTask({
        enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key,
        title, assignee, mode: enr.mode,
        detail: { phone: enr.normalized_phone, student_id: enr.student_id, context: enr.context },
      });
      await data.upsertNodeRun({
        enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key, node_type: "staff_task",
        status: "done", mode: enr.mode,
        outcome: { staff_task_created: true, title, assignee },
      });
      await scheduleNext(data, clock, enr, graph, node.node_key, null, now, res);
      break;
    }
    case "exit":
    default: {
      await data.upsertNodeRun({ enrollment_id: enr.id, workflow_id: enr.workflow_id, node_key: node.node_key, node_type: String(node.type), status: "done", mode: enr.mode });
      await stopEnrollment(data, clock, enr, "exited", "exit_node", res);
      break;
    }
  }

  await data.completeJob(job.id, "done");
}

async function handleFailure(
  data: EngineDataPort,
  clock: Clock,
  job: JobRow,
  err: unknown,
  res: WorkerResult,
): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  res.failed++;
  if (isExhausted(job.attempts, job.max_attempts)) {
    await data.deadLetterJob(job.id, msg);
    res.deadLettered++;
    return;
  }
  const whenISO = new Date(clock.now() + backoffMs(job.attempts)).toISOString();
  await data.rescheduleJob(job.id, whenISO, msg);
}
