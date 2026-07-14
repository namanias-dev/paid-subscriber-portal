"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, useReactFlow, MarkerType,
  type Node, type Edge, type Connection, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./builder.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Save, ShieldCheck, CheckCircle2, PlayCircle, PauseCircle, Copy, History,
  Undo2, Redo2, AlertTriangle, X,
} from "lucide-react";
import { JourneyNode, type JourneyNodeData } from "./JourneyNode";
import NodeLibrary from "./NodeLibrary";
import NodeInspector from "./NodeInspector";
import { catalogByKey, CONDITION_CHECKS, GOAL_TYPES } from "./nodeCatalog";
import { validateGraph, type ValidationReport } from "@/lib/journey-automation/validate";
import type {
  AutomationTemplateOption, AutomationWorkflow, AutomationWorkflowVersion,
  BuilderGraph, WorkflowStatus,
} from "@/types/journey-automation";

const nodeTypes: NodeTypes = { journey: JourneyNode };

export interface BuilderPerms {
  canEdit: boolean;
  canPublish: boolean;
  canPause: boolean;
  canCreate: boolean;
}

const STATUS_LABEL: Record<WorkflowStatus, string> = {
  draft: "Draft", ready: "Ready", active: "Active", paused: "Paused", archived: "Archived", disabled_by_killswitch: "Killed",
};
const STATUS_PILL: Record<WorkflowStatus, string> = {
  draft: "pill-gray", ready: "pill-blue", active: "pill-green", paused: "pill-amber", archived: "pill-gray", disabled_by_killswitch: "pill-red",
};

let keySeq = 0;
function makeKey(type: string): string { keySeq += 1; return `${type}_${Date.now().toString(36)}_${keySeq}`; }

function conditionLabel(check: string): string {
  return CONDITION_CHECKS.find((c) => c.value === check)?.label ?? (check || "Set condition");
}
function goalLabel(goalType: string): string {
  return GOAL_TYPES.find((g) => g.value === goalType)?.label ?? (goalType || "Set goal");
}

function deriveSubtitle(type: string, cfg: Record<string, unknown>, templateName?: string | null): string {
  switch (type) {
    case "trigger": return String(cfg.eventType ?? "");
    case "wait": return `${cfg.durationValue ?? 1} ${cfg.durationUnit ?? "days"}`;
    case "send_sms": return templateName || (cfg.templateName as string) || "No template";
    case "condition": return conditionLabel(String(cfg.check ?? cfg.field ?? ""));
    case "goal": return goalLabel(String(cfg.goalType ?? ""));
    case "staff_task": return String(cfg.assignee ?? "") || "Unassigned";
    case "branch": return `${Array.isArray(cfg.branches) ? cfg.branches.length : 0} paths`;
    case "exit": return "Ends journey";
    default: return "";
  }
}

function toRFNodes(graph: BuilderGraph, templates: AutomationTemplateOption[]): Node[] {
  return graph.nodes.map((n) => {
    const tpl = templates.find((t) => t.id === n.config?.automationTemplateId);
    return {
      id: n.node_key,
      type: "journey",
      position: n.position,
      data: {
        nodeType: n.type,
        title: String(n.config?.title ?? n.type),
        subtitle: deriveSubtitle(n.type, n.config, tpl?.name),
        config: n.config,
        isTrigger: n.type === "trigger",
        isTerminal: n.type === "exit" || n.type === "goal",
        hasError: false,
      } as JourneyNodeData,
    } as Node;
  });
}

function toRFEdges(graph: BuilderGraph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.edge_key,
    source: e.source,
    target: e.target,
    label: e.branch_label ?? undefined,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#9fb3d6" },
    data: { branch_label: e.branch_label, condition: e.condition },
  }));
}

function fromRF(nodes: Node[], edges: Edge[]): BuilderGraph {
  return {
    nodes: nodes.map((n) => {
      const d = n.data as JourneyNodeData & { config?: Record<string, unknown> };
      return { node_key: n.id, type: d.nodeType, config: (d.config ?? {}) as Record<string, unknown>, position: { x: n.position.x, y: n.position.y } };
    }),
    edges: edges.map((e) => ({ edge_key: e.id, source: e.source, target: e.target, branch_label: (e.data as { branch_label?: string | null })?.branch_label ?? (typeof e.label === "string" ? e.label : null), condition: (e.data as { condition?: Record<string, unknown> })?.condition ?? {} })),
  };
}

function BuilderInner({ workflowId, perms }: { workflowId: string; perms: BuilderPerms }) {
  const router = useRouter();
  const { screenToFlowPosition } = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<AutomationTemplateOption[]>([]);
  const [workflow, setWorkflow] = useState<AutomationWorkflow | null>(null);
  const [versions, setVersions] = useState<AutomationWorkflowVersion[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Mirror refs for history/save without stale closures.
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const past = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const future = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [, setHistTick] = useState(0);

  const record = useCallback(() => {
    past.current.push({ nodes: JSON.parse(JSON.stringify(nodesRef.current)), edges: JSON.parse(JSON.stringify(edgesRef.current)) });
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    setHistTick((t) => t + 1);
  }, []);

  const markDirty = useCallback(() => setDirty(true), []);

  // Load editor state + templates.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [stateRes, tplRes] = await Promise.all([
          fetch(`/api/admin/journey-automation/workflows/${workflowId}`).then((r) => r.json()),
          fetch(`/api/admin/journey-automation/templates`).then((r) => r.json()),
        ]);
        if (!alive) return;
        const tpls = (tplRes?.options ?? []) as AutomationTemplateOption[];
        setTemplates(tpls);
        if (stateRes?.ok) {
          setWorkflow(stateRes.workflow);
          setVersions(stateRes.versions ?? []);
          setName(stateRes.workflow?.name ?? "");
          setNodes(toRFNodes(stateRes.graph, tpls));
          setEdges(toRFEdges(stateRes.graph));
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [workflowId, setNodes, setEdges]);

  const flash = useCallback((msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2600); }, []);

  // --- Canvas interactions ---
  const isValidConnection = useCallback((c: Connection | Edge) => {
    if (!c.source || !c.target || c.source === c.target) return false;
    const src = nodesRef.current.find((n) => n.id === c.source);
    const tgt = nodesRef.current.find((n) => n.id === c.target);
    const st = (src?.data as JourneyNodeData)?.nodeType;
    const tt = (tgt?.data as JourneyNodeData)?.nodeType;
    if (st === "exit" || st === "goal") return false; // terminals have no outgoing
    if (tt === "trigger") return false;                // triggers have no incoming
    return true;
  }, []);

  const onConnect = useCallback((c: Connection) => {
    if (!perms.canEdit || !isValidConnection(c)) return;
    record();
    const src = nodesRef.current.find((n) => n.id === c.source);
    const label = (src?.data as JourneyNodeData)?.nodeType === "condition"
      ? (edgesRef.current.filter((e) => e.source === c.source).length === 0 ? "yes" : "no")
      : undefined;
    setEdges((eds) => addEdge({ ...c, id: makeKey("edge"), label, markerEnd: { type: MarkerType.ArrowClosed, color: "#9fb3d6" }, data: { branch_label: label ?? null } }, eds));
    markDirty();
  }, [perms.canEdit, isValidConnection, record, setEdges, markDirty]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!perms.canEdit) return;
    const key = e.dataTransfer.getData("application/journey-node");
    const item = catalogByKey(key);
    if (!item) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    record();
    const cfg = JSON.parse(JSON.stringify(item.defaultConfig)) as Record<string, unknown>;
    const nk = makeKey(item.type);
    const newNode: Node = {
      id: nk, type: "journey", position,
      data: {
        nodeType: item.type, title: String(cfg.title ?? item.label), subtitle: deriveSubtitle(item.type, cfg),
        config: cfg, isTrigger: item.type === "trigger", isTerminal: item.type === "exit" || item.type === "goal", hasError: false,
      } as JourneyNodeData,
    };
    setNodes((nds) => nds.concat(newNode));
    setSelectedId(nk);
    markDirty();
  }, [perms.canEdit, screenToFlowPosition, record, setNodes, markDirty]);

  const updateSelectedConfig = useCallback((patch: Record<string, unknown>) => {
    if (!selectedId) return;
    record();
    setNodes((nds) => nds.map((n) => {
      if (n.id !== selectedId) return n;
      const d = n.data as JourneyNodeData & { config?: Record<string, unknown> };
      const config = { ...(d.config ?? {}), ...patch };
      const tpl = templates.find((t) => t.id === config.automationTemplateId);
      return { ...n, data: { ...d, config, title: String(config.title ?? d.title), subtitle: deriveSubtitle(d.nodeType, config, tpl?.name) } };
    }));
    markDirty();
  }, [selectedId, record, setNodes, templates, markDirty]);

  const deleteSelected = useCallback(() => {
    if (!selectedId || !perms.canEdit) return;
    record();
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
    markDirty();
  }, [selectedId, perms.canEdit, record, setNodes, setEdges, markDirty]);

  const duplicateSelected = useCallback(() => {
    if (!selectedId || !perms.canEdit) return;
    const src = nodesRef.current.find((n) => n.id === selectedId);
    if (!src) return;
    record();
    const d = src.data as JourneyNodeData & { config?: Record<string, unknown> };
    const nk = makeKey(d.nodeType);
    const clone: Node = { ...src, id: nk, position: { x: src.position.x + 40, y: src.position.y + 40 }, selected: false, data: { ...d, config: JSON.parse(JSON.stringify(d.config ?? {})) } };
    setNodes((nds) => nds.concat(clone));
    setSelectedId(nk);
    markDirty();
  }, [selectedId, perms.canEdit, record, setNodes, markDirty]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push({ nodes: JSON.parse(JSON.stringify(nodesRef.current)), edges: JSON.parse(JSON.stringify(edgesRef.current)) });
    setNodes(prev.nodes); setEdges(prev.edges); setDirty(true); setHistTick((t) => t + 1);
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    const nxt = future.current.pop();
    if (!nxt) return;
    past.current.push({ nodes: JSON.parse(JSON.stringify(nodesRef.current)), edges: JSON.parse(JSON.stringify(edgesRef.current)) });
    setNodes(nxt.nodes); setEdges(nxt.edges); setDirty(true); setHistTick((t) => t + 1);
  }, [setNodes, setEdges]);

  // --- Server actions ---
  const currentGraph = useCallback(() => fromRF(nodesRef.current, edgesRef.current), []);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/admin/journey-automation/workflows/${workflowId}`).then((r) => r.json());
    if (res?.ok) {
      setWorkflow(res.workflow); setVersions(res.versions ?? []); setName(res.workflow?.name ?? "");
      setNodes(toRFNodes(res.graph, templates)); setEdges(toRFEdges(res.graph));
    }
  }, [workflowId, templates, setNodes, setEdges]);

  const save = useCallback(async () => {
    if (!perms.canEdit) return;
    setBusy("save");
    try {
      const res = await fetch(`/api/admin/journey-automation/workflows/${workflowId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph: currentGraph() }),
      }).then((r) => r.json());
      if (res?.ok) { setDirty(false); flash("Draft saved"); } else flash(res?.error || "Save failed");
    } finally { setBusy(null); }
  }, [perms.canEdit, workflowId, currentGraph, flash]);

  const applyReport = useCallback((rep: ValidationReport) => {
    setReport(rep);
    const bad = new Set(rep.issues.filter((i) => i.nodeKey).map((i) => i.nodeKey));
    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...(n.data as JourneyNodeData), hasError: bad.has(n.id) } })));
  }, [setNodes]);

  const validate = useCallback(async () => {
    setBusy("validate");
    try {
      // Instant client-side highlight, then the audited server call.
      const g = currentGraph();
      applyReport(validateGraph(g.nodes.map((n) => ({ node_key: n.node_key, type: n.type, config: n.config })), g.edges.map((e) => ({ source: e.source, target: e.target, branch_label: e.branch_label }))));
      const res = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/validate`, { method: "POST" }).then((r) => r.json());
      if (res?.ok) applyReport(res.report);
    } finally { setBusy(null); }
  }, [workflowId, currentGraph, applyReport]);

  const publish = useCallback(async () => {
    if (!perms.canPublish) return;
    setBusy("publish");
    try {
      // Save current draft first so the published snapshot matches the canvas.
      await fetch(`/api/admin/journey-automation/workflows/${workflowId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ graph: currentGraph() }) });
      const res = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeSummary: null }) }).then((r) => r.json());
      if (res?.ok) { setDirty(false); flash(`Published v${res.publishedVersion} — will run once execution is enabled`); await reload(); }
      else { if (res?.report) applyReport(res.report); flash(res?.error || "Publish blocked"); }
    } finally { setBusy(null); }
  }, [perms.canPublish, workflowId, currentGraph, flash, applyReport]);

  const changeStatus = useCallback(async (action: "pause" | "resume" | "archive") => {
    if (!perms.canPause) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).then((r) => r.json());
      if (res?.ok) { flash(`Workflow ${action}d`); await reload(); } else flash(res?.error || "Action failed");
    } finally { setBusy(null); }
  }, [perms.canPause, workflowId, flash]);

  const duplicateWorkflow = useCallback(async () => {
    if (!perms.canCreate) return;
    setBusy("duplicate");
    try {
      const res = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/duplicate`, { method: "POST" }).then((r) => r.json());
      if (res?.ok && res.workflow?.id) router.push(`/admin/communications/journey-automation/${res.workflow.id}`);
    } finally { setBusy(null); }
  }, [perms.canCreate, workflowId, router]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (meta && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (meta && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSelected(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { e.preventDefault(); deleteSelected(); }
      else if (meta && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, duplicateSelected, deleteSelected, selectedId, save]);

  const selectedNode = useMemo(() => {
    const n = nodes.find((x) => x.id === selectedId);
    if (!n) return null;
    const d = n.data as JourneyNodeData & { config?: Record<string, unknown> };
    return { node_key: n.id, type: d.nodeType, config: (d.config ?? {}) as Record<string, unknown> };
  }, [nodes, selectedId]);

  const status = (workflow?.status ?? "draft") as WorkflowStatus;

  if (loading) {
    return <div className="card p-10 text-center text-sm text-muted">Loading builder…</div>;
  }
  if (!workflow) {
    return <div className="card p-10 text-center text-sm text-muted">Workflow not found.</div>;
  }

  return (
    <>
      {/* Toolbar */}
      <div className="ja-toolbar">
        <Link href="/admin/communications/journey-automation" className="ja-btn-sm" title="Back to journeys"><ArrowLeft size={15} /></Link>
        <span className="ja-toolbar-name" aria-label="Workflow name">{name || workflow.name}</span>
        <span className={`pill ${STATUS_PILL[status]}`}>{STATUS_LABEL[status]}</span>
        <span className="text-xs text-muted">{workflow.published_version ? `Published v${workflow.published_version}` : "Never published"}{dirty ? " · Unsaved" : ""}</span>

        <div className="ja-toolbar-spacer" />

        <button className="ja-btn-sm" onClick={undo} disabled={past.current.length === 0} title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
        <button className="ja-btn-sm" onClick={redo} disabled={future.current.length === 0} title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
        <button className="ja-btn-sm" onClick={() => setShowHistory(true)} title="Version history"><History size={15} /> History</button>
        <button className="ja-btn-sm" onClick={duplicateWorkflow} disabled={!perms.canCreate || busy !== null}><Copy size={15} /> Duplicate</button>
        {status === "paused"
          ? <button className="ja-btn-sm" onClick={() => changeStatus("resume")} disabled={!perms.canPause || busy !== null}><PlayCircle size={15} /> Resume</button>
          : <button className="ja-btn-sm" onClick={() => changeStatus("pause")} disabled={!perms.canPause || busy !== null || (status !== "active" && status !== "ready")}><PauseCircle size={15} /> Pause</button>}
        <button className="ja-btn-sm" onClick={validate} disabled={busy !== null}><ShieldCheck size={15} /> Validate</button>
        <button className="ja-btn-sm" onClick={save} disabled={!perms.canEdit || busy !== null}><Save size={15} /> {busy === "save" ? "Saving…" : "Save"}</button>
        <button className="ja-btn-sm" data-variant="primary" onClick={publish} disabled={!perms.canPublish || busy !== null}><CheckCircle2 size={15} /> {busy === "publish" ? "Publishing…" : "Publish"}</button>
      </div>

      {/* Execution-off reassurance */}
      <div className="mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--gold)", background: "var(--gold-soft)", color: "var(--ink2)" }}>
        <ShieldCheck size={14} style={{ color: "var(--gold)" }} aria-hidden="true" />
        Execution &amp; sending are OFF. Publishing freezes an immutable version — it will only run once execution is enabled. No SMS can be sent from here.
      </div>

      {report && (
        <div className="ja-report" style={{ borderColor: report.ok ? "var(--success)" : "var(--danger)" }}>
          <div className="ja-report-head" style={{ background: report.ok ? "#e7f6ec" : "#fdeaea", color: report.ok ? "var(--success)" : "var(--danger)" }}>
            {report.ok ? "Ready to publish" : `${report.errors} issue${report.errors === 1 ? "" : "s"} to fix${report.warnings ? ` · ${report.warnings} warning${report.warnings === 1 ? "" : "s"}` : ""}`}
          </div>
          {report.issues.map((iss, i) => (
            <div key={i} className="ja-report-item" style={{ color: iss.level === "error" ? "var(--danger)" : "var(--warning)" }}>
              <AlertTriangle size={13} aria-hidden="true" /> <span>{iss.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Three-panel builder */}
      <div className="ja-builder" ref={wrapRef}>
        <NodeLibrary disabled={!perms.canEdit} />

        <div className="ja-canvas-wrap" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type === "position" && x.dragging === false)) markDirty(); }}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            onNodeDragStart={() => record()}
            nodeTypes={nodeTypes}
            deleteKeyCode={null}
            snapToGrid
            snapGrid={[16, 16]}
            fitView
            minZoom={0.2}
            maxZoom={1.75}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#c7d2e6" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={() => "#c7d6f0"} maskColor="rgba(10,31,68,0.06)" />
          </ReactFlow>
          {nodes.length === 0 && (
            <div className="ja-empty-hint">
              <div>
                <p className="text-sm font-semibold">Drag a trigger here to begin</p>
                <p className="mt-1 text-xs">Build the journey left-to-right, ending in a Goal and an Exit.</p>
              </div>
            </div>
          )}
        </div>

        <NodeInspector node={selectedNode} templates={templates} canEdit={perms.canEdit} onChange={updateSelectedConfig} onDelete={deleteSelected} />
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-lg" style={{ background: "var(--navy, #0a1f44)" }}>
          {toast}
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowHistory(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-heading text-base font-bold">Version history</h3>
              <button className="ja-btn-sm" onClick={() => setShowHistory(false)}><X size={15} /></button>
            </div>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                  <div>
                    <span className="font-semibold">v{v.version}</span>
                    <span className={`pill ml-2 ${v.status === "published" ? "pill-green" : v.status === "draft" ? "pill-gray" : "pill-amber"}`}>{v.status}</span>
                  </div>
                  <span className="text-xs text-muted">{v.published_at ? new Date(v.published_at).toLocaleString("en-IN") : "—"}</span>
                </div>
              ))}
              {versions.length === 0 && <p className="text-sm text-muted">No versions yet.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function JourneyBuilder({ workflowId, perms }: { workflowId: string; perms: BuilderPerms }) {
  return (
    <ReactFlowProvider>
      <BuilderInner workflowId={workflowId} perms={perms} />
    </ReactFlowProvider>
  );
}
