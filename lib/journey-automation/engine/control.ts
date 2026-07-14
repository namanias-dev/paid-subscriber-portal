/**
 * Execution + canary controls (server-side, audited). This is how a human safely
 * turns the engine on for a workflow:
 *   off  -> matcher skips it entirely (default post-deploy; engine does NOTHING)
 *   simulate -> enroll + run + record would-sends, but SEND NOTHING
 *   live -> enroll + run + SEND, but ONLY if the env flags are also on (fail-closed)
 *
 * Canary caps (max enrollments / staff-test-phone allowlist) bound blast radius.
 * Category pause halts a whole message category. Setting mode='off' or pausing also
 * cancels pending jobs (stop scheduling). Every change is written to the audit log.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { writeAudit, getSettings, type KillSwitchActor } from "../store";
import type { WorkflowExecutionMode } from "./types";

export interface SetExecutionModeInput {
  workflowId: string;
  mode: WorkflowExecutionMode;
  canaryMaxEnrollments?: number | null;
  canaryTestPhones?: string[] | null;
  actor: KillSwitchActor;
}

export async function setExecutionMode(input: SetExecutionModeInput): Promise<{ ok: boolean; cancelledJobs: number }> {
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, cancelledJobs: 0 };

  const { data: before } = await sb.from("automation_workflows").select("execution_mode, canary_max_enrollments, canary_test_phones").eq("id", input.workflowId).maybeSingle();

  const patch: Record<string, unknown> = { execution_mode: input.mode, updated_by: input.actor.id, updated_at: new Date().toISOString() };
  if (input.canaryMaxEnrollments !== undefined) patch["canary_max_enrollments"] = input.canaryMaxEnrollments;
  if (input.canaryTestPhones !== undefined) patch["canary_test_phones"] = input.canaryTestPhones;
  await sb.from("automation_workflows").update(patch).eq("id", input.workflowId);

  // Turning execution off => stop scheduling: cancel pending jobs for this workflow.
  let cancelledJobs = 0;
  if (input.mode === "off") {
    const { data } = await sb.from("automation_jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("workflow_id", input.workflowId).in("status", ["queued", "running"]).select("id");
    cancelledJobs = (data ?? []).length;
  }

  await writeAudit({
    workflow_id: input.workflowId, version_id: null, action: "execution_mode_change", actor: input.actor,
    summary: `execution_mode -> ${input.mode}${cancelledJobs ? ` (cancelled ${cancelledJobs} pending jobs)` : ""}`,
    before: (before as Record<string, unknown>) ?? null,
    after: { execution_mode: input.mode, canary_max_enrollments: patch["canary_max_enrollments"], canary_test_phones: patch["canary_test_phones"] },
  });
  return { ok: true, cancelledJobs };
}

/** Cancel a specific enrollment's remaining journey (cancel pending jobs + exit). */
export async function cancelEnrollment(enrollmentId: string, actor: KillSwitchActor, reason: string): Promise<number> {
  const sb = getSupabaseAdmin();
  if (!sb) return 0;
  const { data } = await sb.from("automation_jobs")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("enrollment_id", enrollmentId).in("status", ["queued", "running"]).select("id");
  await sb.from("automation_enrollments").update({ status: "cancelled", exit_reason: reason, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", enrollmentId);
  await writeAudit({ workflow_id: null, version_id: null, action: "enrollment_cancel", actor, summary: `${enrollmentId}: ${reason}` });
  return (data ?? []).length;
}

/** Per-category pause (e.g. halt all payment_reminder sends) stored in settings.data. */
export async function setCategoryPause(category: string, paused: boolean, actor: KillSwitchActor): Promise<string[]> {
  const sb = getSupabaseAdmin();
  const settings = await getSettings();
  const current = Array.isArray((settings.data as Record<string, unknown>)?.["paused_categories"]) ? ((settings.data as Record<string, unknown>)["paused_categories"] as string[]) : [];
  const next = paused ? Array.from(new Set([...current, category])) : current.filter((c) => c !== category);
  if (sb) {
    const data = { ...(settings.data ?? {}), paused_categories: next };
    await sb.from("automation_settings").update({ data, updated_by: actor.id, updated_at: new Date().toISOString() }).eq("id", "default");
  }
  await writeAudit({ workflow_id: null, version_id: null, action: paused ? "category_pause" : "category_resume", actor, summary: category, before: { paused_categories: current }, after: { paused_categories: next } });
  return next;
}
