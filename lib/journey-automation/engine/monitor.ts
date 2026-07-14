/**
 * Runs / queue / DLQ monitor — READ-ONLY over engine tables, plus a SAFE manual
 * dead-letter retry that only re-enqueues (idempotent, guard-respecting: the worker
 * re-applies latest-state revalidation + sendDecision on re-run, so a retry can
 * never bypass compliance or send in simulation). No business record is touched.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { writeAudit, type KillSwitchActor } from "../store";
import type { EnrollmentRow, JobRow, NodeRunRow } from "./types";

export interface WorkflowRuntimeSummary {
  workflow: {
    id: string; name: string; status: string; execution_mode: string;
    published_version: number | null; canary_max_enrollments: number | null; canary_test_phones: string[] | null;
  } | null;
  killSwitchEngaged: boolean;
  pausedCategories: string[];
  counts: { active: number; completed: number; goal_met: number; exited: number; cancelled: number; failed: number; total: number };
  queue: { queued: number; running: number; dead: number };
}

function maskPhone(p: string | null): string {
  if (!p) return "—";
  return p.length >= 10 ? `${p.slice(0, 2)}****${p.slice(-2)}` : "****";
}

export async function getWorkflowRuntimeSummary(workflowId: string): Promise<WorkflowRuntimeSummary> {
  const empty: WorkflowRuntimeSummary = {
    workflow: null, killSwitchEngaged: false, pausedCategories: [],
    counts: { active: 0, completed: 0, goal_met: 0, exited: 0, cancelled: 0, failed: 0, total: 0 },
    queue: { queued: 0, running: 0, dead: 0 },
  };
  const sb = getSupabaseAdmin();
  if (!sb) return empty;

  const { data: wf } = await sb.from("automation_workflows")
    .select("id, name, status, execution_mode, published_version, canary_max_enrollments, canary_test_phones")
    .eq("id", workflowId).maybeSingle();
  const { data: settings } = await sb.from("automation_settings").select("kill_switch_engaged, data").eq("id", "default").maybeSingle();
  const { data: enr } = await sb.from("automation_enrollments").select("status").eq("workflow_id", workflowId);
  const { data: jobs } = await sb.from("automation_jobs").select("status").eq("workflow_id", workflowId);

  const counts = { active: 0, completed: 0, goal_met: 0, exited: 0, cancelled: 0, failed: 0, total: 0 };
  for (const e of (enr ?? []) as { status: string }[]) {
    counts.total++;
    if (e.status in counts) (counts as Record<string, number>)[e.status]++;
  }
  const queue = { queued: 0, running: 0, dead: 0 };
  for (const j of (jobs ?? []) as { status: string }[]) {
    if (j.status === "queued") queue.queued++;
    else if (j.status === "running") queue.running++;
    else if (j.status === "dead") queue.dead++;
  }
  const paused = ((settings?.data as Record<string, unknown> | undefined)?.["paused_categories"] as string[]) ?? [];
  return {
    workflow: (wf as WorkflowRuntimeSummary["workflow"]) ?? null,
    killSwitchEngaged: !!settings?.kill_switch_engaged,
    pausedCategories: Array.isArray(paused) ? paused : [],
    counts, queue,
  };
}

export interface EnrollmentView {
  id: string; phoneMasked: string; status: string; mode: string; current_node_key: string | null;
  goal_met: boolean; exit_reason: string | null; enrolled_at: string; completed_at: string | null;
}

export async function listEnrollments(workflowId: string, limit = 50): Promise<EnrollmentView[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const { data } = await sb.from("automation_enrollments").select("*")
    .eq("workflow_id", workflowId).order("enrolled_at", { ascending: false }).limit(limit);
  return ((data ?? []) as EnrollmentRow[]).map((e) => ({
    id: e.id, phoneMasked: maskPhone(e.normalized_phone), status: e.status, mode: e.mode,
    current_node_key: e.current_node_key, goal_met: e.goal_met, exit_reason: e.exit_reason,
    enrolled_at: e.enrolled_at, completed_at: e.completed_at,
  }));
}

export async function listNodeRuns(enrollmentId: string): Promise<NodeRunRow[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const { data } = await sb.from("automation_node_runs").select("*")
    .eq("enrollment_id", enrollmentId).order("created_at", { ascending: true });
  // resolved_variables are already stored MINUS secrets by the adapter; return as-is.
  return (data ?? []) as NodeRunRow[];
}

export interface JobView {
  id: string; node_key: string; status: string; scheduled_for: string; attempts: number;
  max_attempts: number; dead_letter: boolean; last_error: string | null;
}

export async function listJobs(workflowId: string, opts: { deadOnly?: boolean; limit?: number } = {}): Promise<JobView[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  let q = sb.from("automation_jobs").select("id, node_key, status, scheduled_for, attempts, max_attempts, dead_letter, last_error")
    .eq("workflow_id", workflowId).order("scheduled_for", { ascending: false }).limit(opts.limit ?? 100);
  if (opts.deadOnly) q = q.eq("status", "dead");
  const { data } = await q;
  return (data ?? []) as JobView[];
}

export async function listStaffTasks(workflowId: string, limit = 50): Promise<Array<{ id: string; title: string; assignee: string | null; status: string; mode: string; created_at: string }>> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const { data } = await sb.from("automation_staff_tasks").select("id, title, assignee, status, mode, created_at")
    .eq("workflow_id", workflowId).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as Array<{ id: string; title: string; assignee: string | null; status: string; mode: string; created_at: string }>;
}

/**
 * PURE retry planner. Only 'dead'/'failed' jobs are retryable; anything else is a
 * no-op (idempotent — retrying a queued/running/done/cancelled job changes nothing).
 * The returned patch ONLY re-enqueues (status='queued') — it can never mark a job
 * "done" or skip the worker, so a retry cannot bypass guards/compliance.
 */
export function planDeadJobRetry(status: string, nowISO: string): { requeue: false } | { requeue: true; patch: Record<string, unknown> } {
  if (status !== "dead" && status !== "failed") return { requeue: false };
  return {
    requeue: true,
    patch: { status: "queued", scheduled_for: nowISO, dead_letter: false, attempts: 0, last_error: null, updated_at: nowISO },
  };
}

/**
 * SAFE manual DLQ retry: re-enqueue a dead/failed job only. Idempotent — a job that
 * is not dead/failed is left untouched. Re-running goes through the full worker path
 * (guards + revalidation + sendDecision), so retry can NEVER bypass compliance.
 */
export async function retryDeadJob(jobId: string, actor: KillSwitchActor): Promise<{ ok: boolean; requeued: boolean; reason?: string }> {
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, requeued: false, reason: "no_db" };
  const { data: job } = await sb.from("automation_jobs").select("id, status, workflow_id").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, requeued: false, reason: "not_found" };
  const plan = planDeadJobRetry((job as { status: string }).status, new Date().toISOString());
  if (!plan.requeue) return { ok: true, requeued: false, reason: `not_retryable:${(job as { status: string }).status}` };
  await sb.from("automation_jobs").update(plan.patch).eq("id", jobId);
  await writeAudit({ workflow_id: (job as { workflow_id: string }).workflow_id, version_id: null, action: "dlq_retry", actor, summary: `Re-enqueued dead job ${jobId}` });
  return { ok: true, requeued: true };
}
