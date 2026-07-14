/**
 * Real EngineDataPort (Supabase service-role). Durable queue semantics:
 *  - createEnrollment / scheduleJob are INSERT-first with UNIQUE dedupe (23505 =>
 *    created:false) so duplicated events/retries can never double-enroll/double-queue.
 *  - claimJobs uses the SKIP LOCKED RPC so overlapping workers never grab a job twice.
 *  - requeueStaleJobs re-queues stuck 'running' jobs => crash recovery.
 * Service-role only; these tables are RLS-locked with no policies.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import type { EngineDataPort, EngineSettings } from "./ports";
import type {
  EnrollmentRow, JobRow, WorkflowRuntimeRow, CandidateWorkflow,
  NodeRunInput, NodeRunRow, ScheduleJobInput, CreateEnrollmentInput,
  GoalCompletionInput, SuppressionInput, StaffTaskInput,
} from "./types";
import type { AutomationEvent, BuilderGraph } from "@/types/journey-automation";
import { parseGraph, triggerNode } from "./graph";

const UNIQUE_VIOLATION = "23505";

function db() {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("journey engine requires service-role Supabase (not available)");
  return sb;
}

export const supabaseEnginePort: EngineDataPort = {
  async getSettings(): Promise<EngineSettings> {
    const sb = getSupabaseAdmin();
    if (!sb) return { killSwitchEngaged: true, pausedCategories: [] }; // fail-closed
    const { data } = await sb.from("automation_settings").select("*").eq("id", "default").maybeSingle();
    const paused = ((data?.data as Record<string, unknown> | undefined)?.["paused_categories"] as string[]) ?? [];
    return { killSwitchEngaged: !!data?.kill_switch_engaged, pausedCategories: Array.isArray(paused) ? paused : [] };
  },

  async getUnprocessedEvents(limit: number): Promise<AutomationEvent[]> {
    const { data } = await db().from("automation_events").select("*")
      .is("processed_at", null).order("occurred_at", { ascending: true }).limit(limit);
    return (data ?? []) as AutomationEvent[];
  },

  async markEventProcessed(eventId: string): Promise<void> {
    await db().from("automation_events").update({ processed_at: new Date().toISOString() }).eq("id", eventId);
  },

  async listCandidateWorkflows(eventType: string): Promise<CandidateWorkflow[]> {
    const sb = db();
    const { data: wfs } = await sb.from("automation_workflows").select("*")
      .in("execution_mode", ["simulate", "live"]).not("published_version", "is", null).eq("killswitch_disabled", false);
    const out: CandidateWorkflow[] = [];
    for (const wf of (wfs ?? []) as WorkflowRuntimeRow[]) {
      const { data: ver } = await sb.from("automation_workflow_versions").select("id, definition")
        .eq("workflow_id", wf.id).eq("status", "published").order("version", { ascending: false }).limit(1).maybeSingle();
      if (!ver) continue;
      const graph = parseGraph((ver as { definition: unknown }).definition);
      const trig = triggerNode(graph);
      const evt = trig?.config?.["eventType"] ?? trig?.config?.["event_type"];
      if (typeof evt === "string" && evt === eventType) {
        out.push({ workflow: wf, version_id: (ver as { id: string }).id, graph });
      }
    }
    return out;
  },

  async countActiveEnrollments(workflowId: string): Promise<number> {
    const { count } = await db().from("automation_enrollments").select("id", { count: "exact", head: true })
      .eq("workflow_id", workflowId).eq("status", "active");
    return count ?? 0;
  },

  async createEnrollment(input: CreateEnrollmentInput): Promise<{ enrollment: EnrollmentRow; created: boolean }> {
    const sb = db();
    const { data, error } = await sb.from("automation_enrollments").insert({
      workflow_id: input.workflow_id, version_id: input.version_id, event_id: input.event_id,
      normalized_phone: input.normalized_phone, student_id: input.student_id, lead_id: input.lead_id,
      enrollment_ref: input.enrollment_ref, mode: input.mode, current_node_key: input.current_node_key,
      context: input.context, dedupe_key: input.dedupe_key,
    }).select("*").maybeSingle();
    if (!error && data) return { enrollment: data as EnrollmentRow, created: true };
    // dedupe conflict (same event or active enrollment) => return existing, created:false
    const { data: existing } = await sb.from("automation_enrollments").select("*")
      .eq("dedupe_key", input.dedupe_key).maybeSingle();
    if (existing) return { enrollment: existing as EnrollmentRow, created: false };
    // active-unique conflict => find the active enrollment for this contact
    const { data: active } = await sb.from("automation_enrollments").select("*")
      .eq("workflow_id", input.workflow_id).eq("normalized_phone", input.normalized_phone).eq("status", "active").maybeSingle();
    if (active) return { enrollment: active as EnrollmentRow, created: false };
    throw error ?? new Error("createEnrollment failed");
  },

  async scheduleJob(input: ScheduleJobInput): Promise<{ created: boolean }> {
    const { error } = await db().from("automation_jobs").insert({
      enrollment_id: input.enrollment_id, workflow_id: input.workflow_id, node_key: input.node_key,
      scheduled_for: input.scheduled_for, dedupe_key: input.dedupe_key, max_attempts: input.max_attempts ?? 5,
    });
    if (!error) return { created: true };
    if (error.code === UNIQUE_VIOLATION) return { created: false };
    throw error;
  },

  async requeueStaleJobs(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const { data } = await db().from("automation_jobs")
      .update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("status", "running").lt("started_at", cutoff).select("id");
    return (data ?? []).length;
  },

  async claimJobs(limit: number): Promise<JobRow[]> {
    const { data, error } = await db().rpc("automation_claim_jobs", { p_limit: limit });
    if (error) throw error;
    return (data ?? []) as JobRow[];
  },

  async completeJob(jobId: string, status: "done" | "cancelled"): Promise<void> {
    await db().from("automation_jobs").update({ status, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId);
  },

  async rescheduleJob(jobId: string, whenISO: string, error: string | null): Promise<void> {
    await db().from("automation_jobs").update({ status: "queued", scheduled_for: whenISO, last_error: error, updated_at: new Date().toISOString() }).eq("id", jobId);
  },

  async deadLetterJob(jobId: string, error: string): Promise<void> {
    await db().from("automation_jobs").update({ status: "dead", dead_letter: true, last_error: error, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId);
  },

  async cancelPendingJobs(enrollmentId: string): Promise<number> {
    const { data } = await db().from("automation_jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("enrollment_id", enrollmentId).in("status", ["queued", "running"]).select("id");
    return (data ?? []).length;
  },

  async getEnrollment(id: string): Promise<EnrollmentRow | null> {
    const { data } = await db().from("automation_enrollments").select("*").eq("id", id).maybeSingle();
    return (data as EnrollmentRow) ?? null;
  },

  async updateEnrollment(id: string, patch: Partial<EnrollmentRow>): Promise<void> {
    await db().from("automation_enrollments").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  },

  async getWorkflow(id: string): Promise<WorkflowRuntimeRow | null> {
    const { data } = await db().from("automation_workflows").select("*").eq("id", id).maybeSingle();
    return (data as WorkflowRuntimeRow) ?? null;
  },

  async getPublishedGraph(versionId: string): Promise<BuilderGraph | null> {
    const { data } = await db().from("automation_workflow_versions").select("definition").eq("id", versionId).maybeSingle();
    if (!data) return null;
    return parseGraph((data as { definition: unknown }).definition);
  },

  async getNodeRun(enrollmentId: string, nodeKey: string): Promise<NodeRunRow | null> {
    const { data } = await db().from("automation_node_runs").select("*").eq("enrollment_id", enrollmentId).eq("node_key", nodeKey).maybeSingle();
    return (data as NodeRunRow) ?? null;
  },

  async upsertNodeRun(input: NodeRunInput): Promise<void> {
    await db().from("automation_node_runs").upsert({
      enrollment_id: input.enrollment_id, workflow_id: input.workflow_id, node_key: input.node_key,
      node_type: input.node_type, status: input.status, mode: input.mode,
      resolved_variables: input.resolved_variables ?? {}, outcome: input.outcome ?? {},
      idempotency_key: input.idempotency_key ?? null, error: input.error ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "enrollment_id,node_key" });
  },

  async recordGoal(input: GoalCompletionInput): Promise<void> {
    const { error } = await db().from("automation_goal_completions").insert({
      enrollment_id: input.enrollment_id, workflow_id: input.workflow_id, goal_node_key: input.goal_node_key,
      goal_type: input.goal_type, attributed_event: input.attributed_event, mode: input.mode,
    });
    if (error && error.code !== UNIQUE_VIOLATION) throw error;
  },

  async recordSuppression(input: SuppressionInput): Promise<void> {
    await db().from("automation_suppression_events").insert({
      enrollment_id: input.enrollment_id, workflow_id: input.workflow_id, node_key: input.node_key,
      normalized_phone: input.normalized_phone, reason: input.reason, detail: input.detail ?? {},
    });
  },

  async createStaffTask(input: StaffTaskInput): Promise<void> {
    const sb = db();
    // Idempotent per (enrollment,node): the node_run UNIQUE already gates re-execution,
    // but guard here too so retries never create duplicate tasks.
    const { data: existing } = await sb.from("automation_staff_tasks").select("id")
      .eq("enrollment_id", input.enrollment_id).eq("node_key", input.node_key).maybeSingle();
    if (existing) return;
    await sb.from("automation_staff_tasks").insert({
      enrollment_id: input.enrollment_id, workflow_id: input.workflow_id, node_key: input.node_key,
      title: input.title, assignee: input.assignee, detail: input.detail ?? {}, mode: input.mode,
    });
  },
};
