/**
 * Journey Automation — draft-graph authoring store (Phase 2, Part B).
 *
 * Reads/writes the EXISTING automation_* draft graph (workflows / versions /
 * nodes / edges / triggers / goals) for the visual builder. Contains NO execution
 * and NO sending — it only persists authoring intent. Publishing freezes an
 * IMMUTABLE version (via the existing versioning logic + DB trigger) but does NOT
 * enable execution (all six flags stay off; the fail-closed guard is the only
 * future action path).
 */
import { getSupabaseAdmin } from "../supabase";
import { listTemplates } from "../sms/store";
import { writeAudit, type KillSwitchActor } from "./store";
import { assertTransition } from "./versioning";
import type {
  AutomationWorkflow,
  AutomationWorkflowVersion,
  AutomationTemplateOption,
  BuilderGraph,
  BuilderNode,
  BuilderEdge,
  WorkflowEditorState,
  WorkflowStatus,
} from "@/types/journey-automation";

type SB = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

// ---------------------------------------------------------------------------
// Demo (no-DB) in-memory fallback so local dev renders without Supabase.
// ---------------------------------------------------------------------------
interface DemoBuilder {
  workflows: AutomationWorkflow[];
  versions: AutomationWorkflowVersion[];
  graphs: Record<string, BuilderGraph>; // keyed by version_id
}
function demo(): DemoBuilder {
  const g = globalThis as unknown as { __journeyBuilder?: DemoBuilder };
  if (!g.__journeyBuilder) g.__journeyBuilder = { workflows: [], versions: [], graphs: {} };
  return g.__journeyBuilder;
}
function nowISO() { return new Date().toISOString(); }
function uid(p: string) { return `${p}-${Math.random().toString(36).slice(2, 10)}`; }

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function createWorkflow(name: string, actor: KillSwitchActor): Promise<AutomationWorkflow> {
  const clean = (name || "Untitled journey").trim().slice(0, 160);
  const sb = getSupabaseAdmin();
  if (!sb) {
    const wf: AutomationWorkflow = {
      id: uid("wf"), name: clean, description: null, status: "draft",
      current_version_id: null, published_version: null, killswitch_disabled: false,
      created_by: actor.id, updated_by: actor.id, created_at: nowISO(), updated_at: nowISO(),
    };
    const ver: AutomationWorkflowVersion = {
      id: uid("ver"), workflow_id: wf.id, version: 1, status: "draft", definition: {},
      change_summary: null, created_by: actor.id, published_by: null, published_at: null,
      is_immutable: false, created_at: nowISO(), updated_at: nowISO(),
    };
    wf.current_version_id = ver.id;
    demo().workflows.unshift(wf);
    demo().versions.unshift(ver);
    demo().graphs[ver.id] = { nodes: [], edges: [] };
    return wf;
  }
  const { data: wfRow, error: wfErr } = await sb
    .from("automation_workflows")
    .insert({ name: clean, status: "draft", created_by: actor.id, updated_by: actor.id })
    .select("*").single();
  if (wfErr || !wfRow) throw new Error(wfErr?.message || "Failed to create workflow");
  const workflow = wfRow as AutomationWorkflow;
  const { data: verRow, error: verErr } = await sb
    .from("automation_workflow_versions")
    .insert({ workflow_id: workflow.id, version: 1, status: "draft", created_by: actor.id })
    .select("*").single();
  if (verErr || !verRow) throw new Error(verErr?.message || "Failed to create version");
  await sb.from("automation_workflows").update({ current_version_id: verRow.id }).eq("id", workflow.id);
  await writeAudit({ workflow_id: workflow.id, version_id: verRow.id, action: "create", actor, summary: `Created journey "${clean}"`, before: null, after: { name: clean, status: "draft" } });
  return { ...workflow, current_version_id: verRow.id };
}

// ---------------------------------------------------------------------------
// Read editor state (workflow + current DRAFT version + graph + version history)
// ---------------------------------------------------------------------------
export async function getEditorState(workflowId: string, actor: KillSwitchActor): Promise<WorkflowEditorState | null> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    const wf = demo().workflows.find((w) => w.id === workflowId);
    if (!wf) return null;
    const versions = demo().versions.filter((v) => v.workflow_id === workflowId).sort((a, b) => b.version - a.version);
    const draft = versions.find((v) => v.status === "draft") ?? versions[0];
    return { workflow: wf, draftVersion: draft, versions, graph: demo().graphs[draft.id] ?? { nodes: [], edges: [] } };
  }
  const { data: wf } = await sb.from("automation_workflows").select("*").eq("id", workflowId).maybeSingle();
  if (!wf) return null;
  const workflow = wf as AutomationWorkflow;
  const { data: versRows } = await sb
    .from("automation_workflow_versions").select("*")
    .eq("workflow_id", workflowId).order("version", { ascending: false });
  const versions = (versRows ?? []) as AutomationWorkflowVersion[];

  let draft = versions.find((v) => v.status === "draft");
  if (!draft) {
    // Only published/archived versions exist — open a fresh draft from the latest.
    draft = await openDraftFrom(sb, workflow, versions, actor);
    versions.unshift(draft);
  }
  const graph = await readBuilderGraph(sb, draft.id);
  return { workflow, draftVersion: draft, versions, graph };
}

/** Open a new draft version (version+1) copying the latest published graph. */
async function openDraftFrom(sb: SB, workflow: AutomationWorkflow, versions: AutomationWorkflowVersion[], actor: KillSwitchActor): Promise<AutomationWorkflowVersion> {
  const nextNo = versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
  const { data: verRow, error } = await sb
    .from("automation_workflow_versions")
    .insert({ workflow_id: workflow.id, version: nextNo, status: "draft", created_by: actor.id })
    .select("*").single();
  if (error || !verRow) throw new Error(error?.message || "Failed to open draft");
  const source = versions.find((v) => v.status === "published") ?? versions[0];
  if (source) await copyGraph(sb, workflow.id, source.id, verRow.id);
  await sb.from("automation_workflows").update({ current_version_id: verRow.id, updated_by: actor.id, updated_at: nowISO() }).eq("id", workflow.id);
  return verRow as AutomationWorkflowVersion;
}

// ---------------------------------------------------------------------------
// Save draft graph — full replace of nodes/edges/triggers/goals for the draft
// version. Blocked if the target version is published/immutable.
// ---------------------------------------------------------------------------
export async function saveDraftGraph(
  workflowId: string,
  graph: BuilderGraph,
  actor: KillSwitchActor,
  changeSummary?: string | null,
): Promise<{ ok: true }> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    const versions = demo().versions.filter((v) => v.workflow_id === workflowId).sort((a, b) => b.version - a.version);
    const draft = versions.find((v) => v.status === "draft");
    if (!draft) throw new Error("No editable draft version");
    demo().graphs[draft.id] = normalizeGraph(graph);
    draft.updated_at = nowISO();
    const wf = demo().workflows.find((w) => w.id === workflowId);
    if (wf) { wf.updated_at = nowISO(); wf.updated_by = actor.id; }
    return { ok: true };
  }
  const { data: draftRow } = await sb
    .from("automation_workflow_versions").select("*")
    .eq("workflow_id", workflowId).eq("status", "draft").order("version", { ascending: false }).limit(1).maybeSingle();
  if (!draftRow) throw new Error("No editable draft version");
  const draft = draftRow as AutomationWorkflowVersion;
  if (draft.status !== "draft" || draft.is_immutable) throw new Error("Draft version is not editable");

  await writeGraph(sb, workflowId, draft.id, normalizeGraph(graph));
  await sb.from("automation_workflow_versions").update({ change_summary: changeSummary ?? draft.change_summary, updated_at: nowISO() }).eq("id", draft.id);
  await sb.from("automation_workflows").update({ updated_by: actor.id, updated_at: nowISO() }).eq("id", workflowId);
  await writeAudit({ workflow_id: workflowId, version_id: draft.id, action: "edit", actor, summary: changeSummary ?? `Saved draft (${graph.nodes.length} nodes)`, before: null, after: { nodes: graph.nodes.length, edges: graph.edges.length } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Publish — freeze the draft into an IMMUTABLE published version, then open the
// next draft. Does NOT enable execution (flags stay off).
// ---------------------------------------------------------------------------
export async function publishWorkflow(
  workflowId: string,
  actor: KillSwitchActor,
  changeSummary: string | null,
): Promise<{ ok: true; publishedVersion: number }> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    const versions = demo().versions.filter((v) => v.workflow_id === workflowId).sort((a, b) => b.version - a.version);
    const draft = versions.find((v) => v.status === "draft");
    if (!draft) throw new Error("No draft to publish");
    const snap = demo().graphs[draft.id] ?? { nodes: [], edges: [] };
    draft.status = "published"; draft.is_immutable = true; draft.published_by = actor.id; draft.published_at = nowISO(); draft.change_summary = changeSummary; draft.definition = snap as unknown as Record<string, unknown>;
    const wf = demo().workflows.find((w) => w.id === workflowId);
    if (wf) { wf.published_version = draft.version; wf.current_version_id = draft.id; wf.status = "ready"; wf.updated_at = nowISO(); }
    const next: AutomationWorkflowVersion = { id: uid("ver"), workflow_id: workflowId, version: draft.version + 1, status: "draft", definition: {}, change_summary: null, created_by: actor.id, published_by: null, published_at: null, is_immutable: false, created_at: nowISO(), updated_at: nowISO() };
    demo().versions.unshift(next);
    demo().graphs[next.id] = JSON.parse(JSON.stringify(snap));
    return { ok: true, publishedVersion: draft.version };
  }
  const { data: draftRow } = await sb
    .from("automation_workflow_versions").select("*")
    .eq("workflow_id", workflowId).eq("status", "draft").order("version", { ascending: false }).limit(1).maybeSingle();
  if (!draftRow) throw new Error("No draft version to publish");
  const draft = draftRow as AutomationWorkflowVersion;

  const snapshot = await readBuilderGraph(sb, draft.id);
  const ts = nowISO();
  // Single draft->published UPDATE (allowed once; the DB trigger freezes it after).
  const { error: freezeErr } = await sb.from("automation_workflow_versions").update({
    status: "published", is_immutable: true, published_by: actor.id, published_at: ts,
    change_summary: changeSummary, definition: snapshot as unknown as Record<string, unknown>, updated_at: ts,
  }).eq("id", draft.id);
  if (freezeErr) throw new Error(freezeErr.message);

  // Arm the workflow (ready = "will run once execution is enabled"). Never 'active'.
  const { data: wf } = await sb.from("automation_workflows").select("*").eq("id", workflowId).maybeSingle();
  const nextStatus: WorkflowStatus = (wf as AutomationWorkflow)?.status === "active" ? "active" : "ready";
  await sb.from("automation_workflows").update({ published_version: draft.version, current_version_id: draft.id, status: nextStatus, updated_by: actor.id, updated_at: ts }).eq("id", workflowId);

  // Open the next editable draft, seeded with the just-published graph.
  const { data: nextRow, error: nextErr } = await sb
    .from("automation_workflow_versions")
    .insert({ workflow_id: workflowId, version: draft.version + 1, status: "draft", created_by: actor.id })
    .select("*").single();
  if (!nextErr && nextRow) await copyGraph(sb, workflowId, draft.id, nextRow.id);

  await writeAudit({ workflow_id: workflowId, version_id: draft.id, action: "publish", actor, summary: changeSummary ?? `Published version ${draft.version}`, before: { status: "draft" }, after: { status: "published", version: draft.version, execution_enabled: false } });
  return { ok: true, publishedVersion: draft.version };
}

// ---------------------------------------------------------------------------
// Status transitions (pause / resume / archive), state-machine guarded + audited
// ---------------------------------------------------------------------------
export async function setWorkflowStatus(workflowId: string, to: WorkflowStatus, actor: KillSwitchActor): Promise<{ ok: true }> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    const wf = demo().workflows.find((w) => w.id === workflowId);
    if (!wf) throw new Error("Workflow not found");
    assertTransition(wf.status, to);
    const before = wf.status; wf.status = to; wf.updated_at = nowISO(); wf.updated_by = actor.id;
    await writeAudit({ workflow_id: workflowId, version_id: null, action: to === "paused" ? "pause" : to === "archived" ? "archive" : "resume", actor, summary: `${before} -> ${to}`, before: { status: before }, after: { status: to } });
    return { ok: true };
  }
  const { data: wf } = await sb.from("automation_workflows").select("*").eq("id", workflowId).maybeSingle();
  if (!wf) throw new Error("Workflow not found");
  const from = (wf as AutomationWorkflow).status;
  assertTransition(from, to);
  await sb.from("automation_workflows").update({ status: to, updated_by: actor.id, updated_at: nowISO() }).eq("id", workflowId);
  await writeAudit({ workflow_id: workflowId, version_id: null, action: to === "paused" ? "pause" : to === "archived" ? "archive" : "resume", actor, summary: `${from} -> ${to}`, before: { status: from }, after: { status: to } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Duplicate — new workflow, fresh draft v1, copy of the current draft graph.
// ---------------------------------------------------------------------------
export async function duplicateWorkflow(workflowId: string, actor: KillSwitchActor): Promise<AutomationWorkflow> {
  const state = await getEditorState(workflowId, actor);
  if (!state) throw new Error("Workflow not found");
  const copy = await createWorkflow(`${state.workflow.name} (Copy)`, actor);
  await saveDraftGraph(copy.id, state.graph, actor, "Duplicated from " + state.workflow.name);
  return copy;
}

// ---------------------------------------------------------------------------
// DLT-approved template options for the SMS node selector.
// ---------------------------------------------------------------------------
export async function listTemplateOptions(): Promise<AutomationTemplateOption[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const [{ data: autoRows }, smsTemplates] = await Promise.all([
    sb.from("automation_templates").select("*"),
    listTemplates(),
  ]);
  const byId = new Map(smsTemplates.map((t) => [t.id, t]));
  return (autoRows ?? []).map((a: Record<string, unknown>) => {
    const t = byId.get(a.sms_template_id as string);
    const approved = !!t && (t.status === "approved" || t.status === "active") && !!t.is_active && !!t.gateway_template_id;
    return {
      id: a.id as string,
      name: (a.name as string) || t?.name || "Template",
      sms_template_id: a.sms_template_id as string,
      dlt_template_id: t?.gateway_template_id ?? null,
      body: t?.body_template ?? "",
      variables: t?.variables ?? [],
      approved,
    };
  });
}

// ---------------------------------------------------------------------------
// Low-level graph helpers
// ---------------------------------------------------------------------------
function normalizeGraph(graph: BuilderGraph): BuilderGraph {
  const nodes: BuilderNode[] = (graph.nodes || []).map((n) => ({
    node_key: n.node_key,
    type: n.type,
    config: n.config ?? {},
    position: { x: Math.round(n.position?.x ?? 0), y: Math.round(n.position?.y ?? 0) },
  }));
  const keys = new Set(nodes.map((n) => n.node_key));
  const edges: BuilderEdge[] = (graph.edges || [])
    .filter((e) => keys.has(e.source) && keys.has(e.target))
    .map((e) => ({ edge_key: e.edge_key, source: e.source, target: e.target, branch_label: e.branch_label ?? null, condition: e.condition ?? {} }));
  return { nodes, edges };
}

async function readBuilderGraph(sb: SB, versionId: string): Promise<BuilderGraph> {
  const [{ data: nodeRows }, { data: edgeRows }] = await Promise.all([
    sb.from("automation_nodes").select("*").eq("version_id", versionId),
    sb.from("automation_edges").select("*").eq("version_id", versionId),
  ]);
  const nodes = (nodeRows ?? []) as Array<{ id: string; node_key: string; type: string; config: Record<string, unknown>; position: Record<string, unknown> }>;
  const idToKey = new Map(nodes.map((n) => [n.id, n.node_key]));
  const bNodes: BuilderNode[] = nodes.map((n) => ({
    node_key: n.node_key, type: n.type, config: n.config ?? {},
    position: { x: Number((n.position as { x?: number })?.x ?? 0), y: Number((n.position as { y?: number })?.y ?? 0) },
  }));
  const bEdges: BuilderEdge[] = ((edgeRows ?? []) as Array<{ id: string; source_node_id: string; target_node_id: string; branch_label: string | null; condition: Record<string, unknown> }>)
    .map((e) => ({ edge_key: e.id, source: idToKey.get(e.source_node_id) || "", target: idToKey.get(e.target_node_id) || "", branch_label: e.branch_label, condition: e.condition ?? {} }))
    .filter((e) => e.source && e.target);
  return { nodes: bNodes, edges: bEdges };
}

/** Full replace of the draft graph tables for a version. */
async function writeGraph(sb: SB, workflowId: string, versionId: string, graph: BuilderGraph): Promise<void> {
  // Clear existing (edges cascade from nodes, but delete explicitly for safety).
  await sb.from("automation_edges").delete().eq("version_id", versionId);
  await sb.from("automation_triggers").delete().eq("version_id", versionId);
  await sb.from("automation_goals").delete().eq("version_id", versionId);
  await sb.from("automation_nodes").delete().eq("version_id", versionId);

  if (graph.nodes.length === 0) return;
  const nodeInsert = graph.nodes.map((n) => ({ workflow_id: workflowId, version_id: versionId, node_key: n.node_key, type: n.type, config: n.config, position: n.position }));
  const { data: inserted, error } = await sb.from("automation_nodes").insert(nodeInsert).select("id, node_key");
  if (error) throw new Error(error.message);
  const keyToId = new Map((inserted ?? []).map((r: { id: string; node_key: string }) => [r.node_key, r.id]));

  if (graph.edges.length) {
    const edgeInsert = graph.edges
      .map((e) => ({ workflow_id: workflowId, version_id: versionId, source_node_id: keyToId.get(e.source), target_node_id: keyToId.get(e.target), branch_label: e.branch_label, condition: e.condition ?? {} }))
      .filter((e) => e.source_node_id && e.target_node_id);
    if (edgeInsert.length) await sb.from("automation_edges").insert(edgeInsert);
  }
  // Mirror trigger/goal nodes into their dedicated tables (enabled=false always).
  const triggerRows = graph.nodes.filter((n) => n.type === "trigger" && n.config?.eventType)
    .map((n) => ({ workflow_id: workflowId, version_id: versionId, event_type: String(n.config.eventType), config: n.config, enabled: false }));
  if (triggerRows.length) await sb.from("automation_triggers").insert(triggerRows);
  const goalRows = graph.nodes.filter((n) => n.type === "goal")
    .map((n) => ({ workflow_id: workflowId, version_id: versionId, name: String(n.config?.title || n.config?.name || "Goal"), goal_type: String(n.config?.goalType || "custom"), config: n.config }));
  if (goalRows.length) await sb.from("automation_goals").insert(goalRows);
}

/** Copy a version's graph into another version_id (used by publish / open-draft). */
async function copyGraph(sb: SB, workflowId: string, fromVersionId: string, toVersionId: string): Promise<void> {
  const graph = await readBuilderGraph(sb, fromVersionId);
  await writeGraph(sb, workflowId, toVersionId, graph);
}
