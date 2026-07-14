/**
 * In-memory fakes for the engine ports. They mirror the real durable semantics
 * (UNIQUE dedupe on enrollments/jobs, SKIP-LOCKED-style single claim, stale-job
 * requeue) so the safety tests are exact — most importantly, RecordingSender lets us
 * assert the chokepoint is NEVER called in simulation.
 */
import type {
  EngineDataPort, StatePort, SenderPort, Clock, EngineSettings,
} from "../../lib/journey-automation/engine/ports";
import type {
  EnrollmentRow, JobRow, WorkflowRuntimeRow, CandidateWorkflow,
  NodeRunInput, NodeRunRow, ScheduleJobInput, CreateEnrollmentInput,
  GoalCompletionInput, SuppressionInput, SendRequest, SendOutcome,
} from "../../lib/journey-automation/engine/types";
import type { AutomationEvent, BuilderGraph } from "../../types/journey-automation";
import type { EligibilityFacts } from "../../lib/journey-automation/engine/eligibility";
import type { LatestState } from "../../lib/journey-automation/engine/latestState";

let SEQ = 0;
const uid = (p: string) => `${p}_${++SEQ}`;

export class MutableClock implements Clock {
  private t: number;
  constructor(start = Date.now()) { this.t = start; }
  now() { return this.t; }
  advance(ms: number) { this.t += ms; }
  set(ms: number) { this.t = ms; }
}

export class RecordingSender implements SenderPort {
  calls: SendRequest[] = [];
  outcome: SendOutcome = { ok: true, logId: "log_x" };
  failWith: string | null = null;
  async send(req: SendRequest): Promise<SendOutcome> {
    this.calls.push(req);
    if (this.failWith) return { ok: false, error: this.failWith };
    return this.outcome;
  }
}

export class ScriptedState implements StatePort {
  facts: EligibilityFacts = {
    normalizedPhone: "9876543210", phoneValid: true, optedOut: false, isStaffOrTest: false,
    alreadyEnrolledActive: false, alreadyConverted: false, canaryAllowed: true,
  };
  latest: LatestState = {
    paid: false, hasOverdue: true, optedOut: false, enrolledInCourse: false,
    registeredForWebinar: false, planPausedOrWaived: false,
  };
  /** Optional per-call override to simulate state changing over time. */
  latestProvider?: (enr: EnrollmentRow) => LatestState;
  async getEligibilityFacts(_wf: WorkflowRuntimeRow, ev: AutomationEvent): Promise<EligibilityFacts> {
    return { ...this.facts, normalizedPhone: ev.phone ?? this.facts.normalizedPhone };
  }
  async getLatestState(enr: EnrollmentRow): Promise<LatestState> {
    return this.latestProvider ? this.latestProvider(enr) : { ...this.latest };
  }
}

export interface FakePortConfig {
  candidatesByEvent?: Record<string, CandidateWorkflow[]>;
  graphsByVersion?: Record<string, BuilderGraph>;
  workflowsById?: Record<string, WorkflowRuntimeRow>;
  settings?: EngineSettings;
}

export class InMemoryPort implements EngineDataPort {
  events: AutomationEvent[] = [];
  enrollments: EnrollmentRow[] = [];
  jobs: JobRow[] = [];
  nodeRuns: NodeRunRow[] = [];
  goals: GoalCompletionInput[] = [];
  suppressions: SuppressionInput[] = [];
  private jobStart: Record<string, number> = {};
  settings: EngineSettings;
  cfg: FakePortConfig;
  clock: Clock;

  constructor(cfg: FakePortConfig, clock: Clock) {
    this.cfg = cfg;
    this.clock = clock;
    this.settings = cfg.settings ?? { killSwitchEngaged: false, pausedCategories: [] };
  }

  async getSettings(): Promise<EngineSettings> { return this.settings; }

  async getUnprocessedEvents(limit: number): Promise<AutomationEvent[]> {
    return this.events.filter((e) => !(e as { processed_at?: string }).processed_at).slice(0, limit);
  }
  async markEventProcessed(eventId: string): Promise<void> {
    const e = this.events.find((x) => x.id === eventId);
    if (e) (e as { processed_at?: string }).processed_at = new Date(this.clock.now()).toISOString();
  }
  async listCandidateWorkflows(eventType: string): Promise<CandidateWorkflow[]> {
    return this.cfg.candidatesByEvent?.[eventType] ?? [];
  }
  async countActiveEnrollments(workflowId: string): Promise<number> {
    return this.enrollments.filter((e) => e.workflow_id === workflowId && e.status === "active").length;
  }
  async createEnrollment(input: CreateEnrollmentInput): Promise<{ enrollment: EnrollmentRow; created: boolean }> {
    const dup = this.enrollments.find((e) => e.dedupe_key && e.dedupe_key === input.dedupe_key);
    if (dup) return { enrollment: dup, created: false };
    const activeDup = this.enrollments.find((e) => e.workflow_id === input.workflow_id && e.normalized_phone === input.normalized_phone && e.status === "active");
    if (activeDup) return { enrollment: activeDup, created: false };
    const row: EnrollmentRow = {
      id: uid("enr"), workflow_id: input.workflow_id, version_id: input.version_id, event_id: input.event_id,
      normalized_phone: input.normalized_phone, student_id: input.student_id, lead_id: input.lead_id,
      enrollment_ref: input.enrollment_ref, mode: input.mode, status: "active",
      current_node_key: input.current_node_key, context: input.context, goal_met: false, exit_reason: null,
      dedupe_key: input.dedupe_key, enrolled_at: new Date(this.clock.now()).toISOString(),
      updated_at: new Date(this.clock.now()).toISOString(), completed_at: null,
    };
    this.enrollments.push(row);
    return { enrollment: row, created: true };
  }

  async scheduleJob(input: ScheduleJobInput): Promise<{ created: boolean }> {
    if (this.jobs.find((j) => j.dedupe_key && j.dedupe_key === input.dedupe_key)) return { created: false };
    this.jobs.push({
      id: uid("job"), enrollment_id: input.enrollment_id, workflow_id: input.workflow_id,
      node_key: input.node_key, kind: "execute_node", status: "queued", scheduled_for: input.scheduled_for,
      attempts: 0, max_attempts: input.max_attempts ?? 5, dedupe_key: input.dedupe_key,
      last_error: null, dead_letter: false,
    });
    return { created: true };
  }
  async requeueStaleJobs(olderThanMs: number): Promise<number> {
    const cutoff = this.clock.now() - olderThanMs;
    let n = 0;
    for (const j of this.jobs) {
      if (j.status === "running" && (this.jobStart[j.id] ?? Infinity) < cutoff) { j.status = "queued"; n++; }
    }
    return n;
  }
  async claimJobs(limit: number): Promise<JobRow[]> {
    const now = this.clock.now();
    const due = this.jobs
      .filter((j) => j.status === "queued" && new Date(j.scheduled_for).getTime() <= now)
      .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime())
      .slice(0, limit);
    for (const j of due) { j.status = "running"; j.attempts += 1; this.jobStart[j.id] = now; }
    return due.map((j) => ({ ...j }));
  }
  async completeJob(jobId: string, status: "done" | "cancelled"): Promise<void> {
    const j = this.jobs.find((x) => x.id === jobId); if (j) j.status = status;
  }
  async rescheduleJob(jobId: string, whenISO: string, error: string | null): Promise<void> {
    const j = this.jobs.find((x) => x.id === jobId);
    if (j) { j.status = "queued"; j.scheduled_for = whenISO; j.last_error = error; }
  }
  async deadLetterJob(jobId: string, error: string): Promise<void> {
    const j = this.jobs.find((x) => x.id === jobId);
    if (j) { j.status = "dead"; j.dead_letter = true; j.last_error = error; }
  }
  async cancelPendingJobs(enrollmentId: string): Promise<number> {
    let n = 0;
    for (const j of this.jobs) {
      if (j.enrollment_id === enrollmentId && (j.status === "queued" || j.status === "running")) { j.status = "cancelled"; n++; }
    }
    return n;
  }
  async getEnrollment(id: string): Promise<EnrollmentRow | null> {
    return this.enrollments.find((e) => e.id === id) ?? null;
  }
  async updateEnrollment(id: string, patch: Partial<EnrollmentRow>): Promise<void> {
    const e = this.enrollments.find((x) => x.id === id); if (e) Object.assign(e, patch);
  }
  async getWorkflow(id: string): Promise<WorkflowRuntimeRow | null> {
    return this.cfg.workflowsById?.[id] ?? null;
  }
  async getPublishedGraph(versionId: string): Promise<BuilderGraph | null> {
    return this.cfg.graphsByVersion?.[versionId] ?? null;
  }
  async getNodeRun(enrollmentId: string, nodeKey: string): Promise<NodeRunRow | null> {
    return this.nodeRuns.find((r) => r.enrollment_id === enrollmentId && r.node_key === nodeKey) ?? null;
  }
  async upsertNodeRun(input: NodeRunInput): Promise<void> {
    const existing = this.nodeRuns.find((r) => r.enrollment_id === input.enrollment_id && r.node_key === input.node_key);
    if (existing) Object.assign(existing, input);
    else this.nodeRuns.push({ id: uid("nr"), ...input });
  }
  async recordGoal(input: GoalCompletionInput): Promise<void> {
    if (this.goals.find((g) => g.enrollment_id === input.enrollment_id && g.goal_node_key === input.goal_node_key)) return;
    this.goals.push(input);
  }
  async recordSuppression(input: SuppressionInput): Promise<void> { this.suppressions.push(input); }

  // test helpers
  activeJobs() { return this.jobs.filter((j) => j.status === "queued" || j.status === "running"); }
  jobByNode(nodeKey: string) { return this.jobs.find((j) => j.node_key === nodeKey); }
}

// ---- graph + fixtures ----------------------------------------------------

export function makeEvent(over: Partial<AutomationEvent> = {}): AutomationEvent {
  return {
    id: over.id ?? uid("evt"), event_type: over.event_type ?? "installment_overdue",
    occurred_at: over.occurred_at ?? new Date().toISOString(), student_id: over.student_id ?? "stu1",
    lead_id: over.lead_id ?? null, enrollment_id: over.enrollment_id ?? "cenr1", webinar_id: over.webinar_id ?? null,
    payment_id: over.payment_id ?? null, phone: over.phone ?? "9876543210", payload: over.payload ?? {},
    dedupe_key: over.dedupe_key ?? null, source: over.source ?? "test", created_at: over.created_at ?? new Date().toISOString(),
  };
}

export function workflow(over: Partial<WorkflowRuntimeRow> = {}): WorkflowRuntimeRow {
  return {
    id: over.id ?? "wf1", name: over.name ?? "Test Journey", status: over.status ?? "ready",
    published_version: over.published_version ?? 1, current_version_id: over.current_version_id ?? "ver1",
    execution_mode: over.execution_mode ?? "simulate", killswitch_disabled: over.killswitch_disabled ?? false,
    canary_max_enrollments: over.canary_max_enrollments ?? null, canary_test_phones: over.canary_test_phones ?? null,
  };
}

/**
 * Realistic payment-reminder journey:
 *   trigger → wait → condition(is_paid?)
 *     ├─ yes → goal(payment_completed) → exit
 *     └─ no  → send_sms(payment_reminder) → exit
 * The goal node declares goal_type so latest-state revalidation can catch payment
 * at ANY node (cancel the pending reminder the instant the student pays).
 */
export function paymentReminderGraph(): BuilderGraph {
  return {
    nodes: [
      { node_key: "n_trigger", type: "trigger", config: { eventType: "installment_overdue" }, position: { x: 0, y: 0 } },
      { node_key: "n_wait", type: "wait", config: { duration: 2, unit: "days" }, position: { x: 0, y: 1 } },
      { node_key: "n_cond", type: "condition", config: { check: "is_paid" }, position: { x: 0, y: 2 } },
      { node_key: "n_goal", type: "goal", config: { goal_type: "payment_completed" }, position: { x: 0, y: 3 } },
      { node_key: "n_sms", type: "send_sms", config: { category: "payment_reminder", templateId: "tmpl_reminder", variables: { name: "there" } }, position: { x: 0, y: 4 } },
      { node_key: "n_exit", type: "exit", config: {}, position: { x: 0, y: 5 } },
    ],
    edges: [
      { edge_key: "e1", source: "n_trigger", target: "n_wait", branch_label: null },
      { edge_key: "e2", source: "n_wait", target: "n_cond", branch_label: null },
      { edge_key: "e3", source: "n_cond", target: "n_goal", branch_label: "yes" },
      { edge_key: "e4", source: "n_cond", target: "n_sms", branch_label: "no" },
      { edge_key: "e5", source: "n_goal", target: "n_exit", branch_label: null },
      { edge_key: "e6", source: "n_sms", target: "n_exit", branch_label: null },
    ],
  };
}

export function candidate(wf: WorkflowRuntimeRow, graph: BuilderGraph): CandidateWorkflow {
  return { workflow: wf, version_id: wf.current_version_id ?? "ver1", graph };
}

/** Run the worker repeatedly (advancing the clock past waits) until it settles. */
export async function drainWorker(
  runWorker: (d: EngineDataPort, s: SenderPort, st: StatePort, c: Clock, o?: unknown) => Promise<unknown>,
  data: InMemoryPort, sender: SenderPort, state: StatePort, clock: MutableClock, opts?: unknown, maxTicks = 20,
): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    const before = data.jobs.filter((j) => j.status !== "queued" && j.status !== "running").length;
    await runWorker(data, sender, state, clock, opts as never);
    const pending = data.activeJobs();
    if (pending.length === 0) return;
    // jump to the next scheduled job so waits elapse
    const nextAt = Math.min(...pending.map((j) => new Date(j.scheduled_for).getTime()));
    if (nextAt > clock.now()) clock.set(nextAt);
    const after = data.jobs.filter((j) => j.status !== "queued" && j.status !== "running").length;
    if (after === before && nextAt <= clock.now()) { /* progress guard */ }
  }
}
