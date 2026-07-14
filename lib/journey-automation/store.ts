/**
 * Data layer for Journey Automation (foundation). Read-focused: lists workflows +
 * versions for the read-only dashboard, reads/writes the global kill-switch
 * setting, and appends audit rows. Supabase service-role in live mode; a safe
 * in-memory fallback in demo mode so the portal renders with no DB. Never throws
 * into callers.
 *
 * This layer contains NO sending and NO execution. It cannot enroll, schedule, or
 * dispatch anything. All future sends go through lib/sms/service.ts.
 */
import { getSupabaseAdmin } from "../supabase";
import type {
  AutomationAuditLog,
  AutomationSettings,
  AutomationWorkflow,
  AutomationWorkflowVersion,
  WorkflowWithVersions,
} from "@/types/journey-automation";

const DEFAULT_SETTINGS: AutomationSettings = {
  id: "default",
  kill_switch_engaged: false,
  kill_switch_reason: null,
  kill_switch_by: null,
  kill_switch_at: null,
  data: {},
  updated_by: null,
  updated_at: new Date(0).toISOString(),
};

interface DemoStore {
  workflows: AutomationWorkflow[];
  versions: AutomationWorkflowVersion[];
  audit: AutomationAuditLog[];
  settings: AutomationSettings;
}

function demo(): DemoStore {
  const g = globalThis as unknown as { __journeyStore?: DemoStore };
  if (!g.__journeyStore) {
    g.__journeyStore = { workflows: [], versions: [], audit: [], settings: { ...DEFAULT_SETTINGS } };
  }
  return g.__journeyStore;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listWorkflows(): Promise<AutomationWorkflow[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return demo().workflows;
  const { data, error } = await sb
    .from("automation_workflows")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return data as AutomationWorkflow[];
}

export async function getWorkflowWithVersions(id: string): Promise<WorkflowWithVersions | null> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    const wf = demo().workflows.find((w) => w.id === id);
    if (!wf) return null;
    return { ...wf, versions: demo().versions.filter((v) => v.workflow_id === id) };
  }
  const { data: wf, error } = await sb.from("automation_workflows").select("*").eq("id", id).maybeSingle();
  if (error || !wf) return null;
  const { data: versions } = await sb
    .from("automation_workflow_versions")
    .select("*")
    .eq("workflow_id", id)
    .order("version", { ascending: false });
  return { ...(wf as AutomationWorkflow), versions: (versions ?? []) as AutomationWorkflowVersion[] };
}

/** Latest version rows across all workflows (for compact dashboard summaries). */
export async function listVersions(): Promise<AutomationWorkflowVersion[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return demo().versions;
  const { data } = await sb
    .from("automation_workflow_versions")
    .select("*")
    .order("version", { ascending: false });
  return (data ?? []) as AutomationWorkflowVersion[];
}

// ---------------------------------------------------------------------------
// Settings + global kill switch
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<AutomationSettings> {
  const sb = getSupabaseAdmin();
  if (!sb) return demo().settings;
  const { data } = await sb.from("automation_settings").select("*").eq("id", "default").maybeSingle();
  if (!data) return { ...DEFAULT_SETTINGS };
  return data as AutomationSettings;
}

export interface KillSwitchActor {
  id: string | null;
  name: string | null;
  role: string | null;
  isSuper: boolean;
}

/** Engage/disengage the GLOBAL kill switch. Audit-logged. Returns new settings. */
export async function setKillSwitch(
  engaged: boolean,
  reason: string | null,
  actor: KillSwitchActor,
): Promise<AutomationSettings> {
  const nowISO = new Date().toISOString();
  const patch = {
    kill_switch_engaged: engaged,
    kill_switch_reason: reason,
    kill_switch_by: actor.id,
    kill_switch_at: nowISO,
    updated_by: actor.id,
    updated_at: nowISO,
  };
  const sb = getSupabaseAdmin();
  if (!sb) {
    demo().settings = { ...demo().settings, ...patch };
    await writeAudit({
      workflow_id: null,
      version_id: null,
      action: engaged ? "killswitch_on" : "killswitch_off",
      actor,
      summary: reason,
      before: { kill_switch_engaged: !engaged },
      after: { kill_switch_engaged: engaged },
    });
    return demo().settings;
  }
  const { data } = await sb
    .from("automation_settings")
    .update(patch)
    .eq("id", "default")
    .select("*")
    .maybeSingle();
  await writeAudit({
    workflow_id: null,
    version_id: null,
    action: engaged ? "killswitch_on" : "killswitch_off",
    actor,
    summary: reason,
    before: { kill_switch_engaged: !engaged },
    after: { kill_switch_engaged: engaged },
  });
  return (data as AutomationSettings) ?? { ...DEFAULT_SETTINGS, ...patch };
}

// ---------------------------------------------------------------------------
// Audit (append-only)
// ---------------------------------------------------------------------------

export interface WriteAuditInput {
  workflow_id: string | null;
  version_id: string | null;
  action: AutomationAuditLog["action"];
  actor: KillSwitchActor;
  summary?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export async function writeAudit(input: WriteAuditInput): Promise<void> {
  const row = {
    workflow_id: input.workflow_id,
    version_id: input.version_id,
    action: input.action,
    actor_id: input.actor.id,
    actor_name: input.actor.name,
    actor_role: input.actor.role,
    actor_is_super: input.actor.isSuper,
    before: input.before ?? null,
    after: input.after ?? null,
    summary: input.summary ?? null,
  };
  const sb = getSupabaseAdmin();
  if (!sb) {
    demo().audit.unshift({ id: `demo-${demo().audit.length + 1}`, created_at: new Date().toISOString(), ...row } as AutomationAuditLog);
    return;
  }
  await sb.from("automation_audit_logs").insert(row);
}

export async function listAudit(workflowId?: string, limit = 100): Promise<AutomationAuditLog[]> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    const rows = demo().audit;
    return workflowId ? rows.filter((r) => r.workflow_id === workflowId) : rows.slice(0, limit);
  }
  let q = sb.from("automation_audit_logs").select("*").order("created_at", { ascending: false }).limit(limit);
  if (workflowId) q = q.eq("workflow_id", workflowId);
  const { data } = await q;
  return (data ?? []) as AutomationAuditLog[];
}
