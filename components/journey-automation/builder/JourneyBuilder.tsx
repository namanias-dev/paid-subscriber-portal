"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, Panel,
  addEdge, reconnectEdge, useNodesState, useEdgesState, useReactFlow, MarkerType,
  type Node, type Edge, type Connection, type NodeTypes, type FinalConnectionState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./builder.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Save, ShieldCheck, CheckCircle2, PlayCircle, PauseCircle, Copy, History,
  Undo2, Redo2, AlertTriangle, X, Wand2, Trash2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
} from "lucide-react";
import { JourneyNode, type JourneyNodeData } from "./JourneyNode";
import NodeLibrary from "./NodeLibrary";
import NodeInspector from "./NodeInspector";
import { BuilderIcon } from "./builderIcons";
import { catalogByKey, CONDITION_CHECKS, GOAL_TYPES, NODE_CATALOG } from "./nodeCatalog";
import { validateGraph, type ValidationReport } from "@/lib/journey-automation/validate";
import {
  outputHandles, branchDisplayLabel, planConnection, executableGraph, isNoteType,
} from "@/lib/journey-automation/builderGraphMap";
import { summarizeTriggerFilters, type TriggerSources } from "@/lib/journey-automation/engine/triggerMatch";
import { effectiveJourneyState, effectiveTonePill, type ExecutionMode } from "@/lib/journey-automation/effectiveState";
import type { JourneyFlagSnapshot } from "@/lib/journey-automation/flags";
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

const EDGE_TINT: Record<string, string> = { yes: "#16a34a", no: "#dc2626" };
/** Nodes offered by the quick-add picker (no trigger — has no incoming; no note). */
const QUICK_ADD_ITEMS = NODE_CATALOG.filter((n) => n.type !== "trigger" && n.type !== "note");

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
    case "trigger": {
      const summary = summarizeTriggerFilters(String(cfg.eventType ?? ""), cfg);
      return summary === "All sources" ? String(cfg.eventType ?? "") : summary;
    }
    case "wait": return `${cfg.durationValue ?? 1} ${cfg.durationUnit ?? "days"}`;
    case "send_sms": return templateName || (cfg.templateName as string) || "No template";
    case "condition": return conditionLabel(String(cfg.check ?? cfg.field ?? ""));
    case "goal": return goalLabel(String(cfg.goalType ?? ""));
    case "staff_task": return String(cfg.assignee ?? "") || "Unassigned";
    case "branch": return `${Array.isArray(cfg.branches) ? cfg.branches.length : 0} paths`;
    case "exit": return "Ends journey";
    case "note": return "";
    default: return "";
  }
}

function nodeData(type: string, cfg: Record<string, unknown>, templateName?: string | null): JourneyNodeData {
  return {
    nodeType: type,
    title: String(cfg.title ?? type),
    subtitle: deriveSubtitle(type, cfg, templateName),
    description: typeof cfg.description === "string" ? cfg.description : (type === "note" ? String(cfg.text ?? "") : undefined),
    config: cfg,
    isTrigger: type === "trigger",
    isTerminal: type === "exit" || type === "goal",
    handles: outputHandles({ type, config: cfg }),
    hasError: false,
  } as JourneyNodeData;
}

function toRFNodes(graph: BuilderGraph, templates: AutomationTemplateOption[]): Node[] {
  return graph.nodes.map((n) => {
    const tpl = templates.find((t) => t.id === n.config?.automationTemplateId);
    return { id: n.node_key, type: "journey", position: n.position, data: nodeData(n.type, n.config ?? {}, tpl?.name) } as Node;
  });
}

function styleEdge(branch: string | null | undefined): Partial<Edge> {
  const tint = branch ? (EDGE_TINT[branch] ?? "#7c3aed") : "#9fb3d6";
  return {
    label: branch ? branchDisplayLabel(branch) : undefined,
    labelStyle: { fill: tint, fontWeight: 700, fontSize: 11 },
    labelBgStyle: { fill: "#fff", fillOpacity: 0.9 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 6,
    style: { stroke: tint, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: tint },
  };
}

function toRFEdges(graph: BuilderGraph): Edge[] {
  const typeByKey = new Map(graph.nodes.map((n) => [n.node_key, n.type]));
  return graph.edges.map((e) => {
    const isBranchSrc = typeByKey.get(e.source) === "condition" || typeByKey.get(e.source) === "branch";
    return {
      id: e.edge_key,
      source: e.source,
      target: e.target,
      sourceHandle: isBranchSrc ? (e.branch_label ?? null) : null,
      ...styleEdge(isBranchSrc ? e.branch_label : null),
      data: { branch_label: e.branch_label, condition: e.condition },
    } as Edge;
  });
}

function fromRF(nodes: Node[], edges: Edge[]): BuilderGraph {
  const typeByKey = new Map(nodes.map((n) => [n.id, (n.data as JourneyNodeData).nodeType]));
  return {
    nodes: nodes.map((n) => {
      const d = n.data as JourneyNodeData & { config?: Record<string, unknown> };
      return { node_key: n.id, type: d.nodeType, config: (d.config ?? {}) as Record<string, unknown>, position: { x: n.position.x, y: n.position.y } };
    }),
    edges: edges.map((e) => {
      const isBranchSrc = typeByKey.get(e.source) === "condition" || typeByKey.get(e.source) === "branch";
      const branch = isBranchSrc
        ? (e.sourceHandle ?? (e.data as { branch_label?: string | null })?.branch_label ?? null)
        : ((e.data as { branch_label?: string | null })?.branch_label ?? null);
      return { edge_key: e.id, source: e.source, target: e.target, branch_label: branch ? String(branch).toLowerCase() : null, condition: (e.data as { condition?: Record<string, unknown> })?.condition ?? {} };
    }),
  };
}

/** Layered left-to-right auto-layout ("Tidy up"). Notes keep their positions. */
function tidyPositions(nodes: Node[], edges: Edge[]): Map<string, { x: number; y: number }> {
  const COL = 280, ROW = 128;
  const exec = nodes.filter((n) => !isNoteType((n.data as JourneyNodeData).nodeType));
  const ids = new Set(exec.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  exec.forEach((n) => incoming.set(n.id, []));
  edges.forEach((e) => { if (ids.has(e.source) && ids.has(e.target)) incoming.get(e.target)!.push(e.source); });
  // Kahn topological order (graph is acyclic by construction).
  const indeg = new Map(exec.map((n) => [n.id, (incoming.get(n.id) ?? []).length]));
  const queue = exec.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  const out = new Map<string, string[]>();
  edges.forEach((e) => { if (ids.has(e.source) && ids.has(e.target)) (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e.target); });
  while (queue.length) {
    const cur = queue.shift()!; order.push(cur);
    for (const nxt of out.get(cur) ?? []) { indeg.set(nxt, (indeg.get(nxt) ?? 1) - 1); if ((indeg.get(nxt) ?? 0) === 0) queue.push(nxt); }
  }
  for (const n of exec) if (!order.includes(n.id)) order.push(n.id);
  const depth = new Map<string, number>();
  for (const id of order) {
    const preds = incoming.get(id) ?? [];
    depth.set(id, preds.length ? Math.max(...preds.map((p) => (depth.get(p) ?? 0) + 1)) : 0);
  }
  const byDepth = new Map<number, string[]>();
  for (const n of exec) { const dd = depth.get(n.id) ?? 0; (byDepth.get(dd) ?? byDepth.set(dd, []).get(dd)!).push(n.id); }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [dd, list] of byDepth) list.forEach((id, i) => pos.set(id, { x: dd * COL, y: i * ROW - ((list.length - 1) * ROW) / 2 }));
  return pos;
}

interface QuickAdd { source: string; handleId: string | null; flow: { x: number; y: number }; screen: { x: number; y: number } }

function BuilderInner({ workflowId, perms }: { workflowId: string; perms: BuilderPerms }) {
  const router = useRouter();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Re-fit the canvas shortly after a layout change (panel collapse / resize) so
  // the graph always uses the available space at any window size.
  const refitSoon = useCallback(() => {
    window.setTimeout(() => { try { fitView({ padding: 0.2, duration: 200 }); } catch { /* noop */ } }, 60);
  }, [fitView]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<AutomationTemplateOption[]>([]);
  const [triggerSources, setTriggerSources] = useState<TriggerSources>({});
  const [flags, setFlags] = useState<JourneyFlagSnapshot | null>(null);
  const [killSwitchEngaged, setKillSwitchEngaged] = useState(false);
  const [workflow, setWorkflow] = useState<AutomationWorkflow | null>(null);
  const [versions, setVersions] = useState<AutomationWorkflowVersion[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAdd | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const past = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const future = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [, setHistTick] = useState(0);
  const connectingRef = useRef<{ nodeId: string; handleId: string | null } | null>(null);

  const record = useCallback(() => {
    past.current.push({ nodes: JSON.parse(JSON.stringify(nodesRef.current)), edges: JSON.parse(JSON.stringify(edgesRef.current)) });
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    setHistTick((t) => t + 1);
  }, []);

  const markDirty = useCallback(() => setDirty(true), []);
  const flash = useCallback((msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2600); }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [stateRes, tplRes, srcRes] = await Promise.all([
          fetch(`/api/admin/journey-automation/workflows/${workflowId}`).then((r) => r.json()),
          fetch(`/api/admin/journey-automation/templates`).then((r) => r.json()),
          fetch(`/api/admin/journey-automation/trigger-sources`).then((r) => r.json()).catch(() => null),
        ]);
        if (!alive) return;
        const tpls = (tplRes?.options ?? []) as AutomationTemplateOption[];
        setTemplates(tpls);
        if (srcRes?.ok) setTriggerSources(srcRes.sources ?? {});
        if (stateRes?.ok) {
          setWorkflow(stateRes.workflow);
          setVersions(stateRes.versions ?? []);
          setName(stateRes.workflow?.name ?? "");
          setFlags(stateRes.flags ?? null);
          setKillSwitchEngaged(!!stateRes.killSwitch?.engaged);
          setNodes(toRFNodes(stateRes.graph, tpls));
          setEdges(toRFEdges(stateRes.graph));
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [workflowId, setNodes, setEdges]);

  // --- Connection rules ---
  const isValidConnection = useCallback((c: Connection | Edge) => {
    if (!c.source || !c.target || c.source === c.target) return false;
    const src = nodesRef.current.find((n) => n.id === c.source);
    const tgt = nodesRef.current.find((n) => n.id === c.target);
    const st = (src?.data as JourneyNodeData)?.nodeType;
    const tt = (tgt?.data as JourneyNodeData)?.nodeType;
    if (!st || !tt) return false;
    if (st === "exit" || st === "goal" || st === "note") return false; // terminals / notes have no outgoing
    if (tt === "trigger" || tt === "note") return false;               // triggers / notes have no incoming
    const g = fromRF(nodesRef.current, edgesRef.current);
    const plan = planConnection(g.edges, { source: c.source, target: c.target, sourceHandle: c.sourceHandle, sourceType: st });
    return plan.ok;
  }, []);

  const applyConnection = useCallback((c: Connection) => {
    const src = nodesRef.current.find((n) => n.id === c.source);
    const st = (src?.data as JourneyNodeData)?.nodeType;
    const g = fromRF(nodesRef.current, edgesRef.current);
    const plan = planConnection(g.edges, { source: c.source!, target: c.target!, sourceHandle: c.sourceHandle, sourceType: st });
    if (!plan.ok) { flash(plan.reason || "That connection isn't allowed."); return; }
    record();
    setEdges((eds) => {
      const kept = eds.filter((e) => !plan.replaces.includes(e.id));
      return addEdge({
        ...c,
        id: makeKey("edge"),
        ...styleEdge(plan.branch_label),
        data: { branch_label: plan.branch_label ?? null },
      }, kept);
    });
    markDirty();
  }, [record, setEdges, markDirty, flash]);

  const onConnect = useCallback((c: Connection) => {
    if (!perms.canEdit) return;
    applyConnection(c);
  }, [perms.canEdit, applyConnection]);

  const onConnectStart = useCallback((_: unknown, params: { nodeId: string | null; handleId: string | null }) => {
    connectingRef.current = params.nodeId ? { nodeId: params.nodeId, handleId: params.handleId } : null;
  }, []);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    const info = connectingRef.current; connectingRef.current = null;
    if (!perms.canEdit || !info) return;
    if (state?.isValid) return; // landed on a node → onConnect handled it
    const src = nodesRef.current.find((n) => n.id === info.nodeId);
    const st = (src?.data as JourneyNodeData)?.nodeType;
    if (!st || st === "exit" || st === "goal" || st === "note") return;
    const pt = "changedTouches" in event ? event.changedTouches[0] : (event as MouseEvent);
    const flow = screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
    setQuickAdd({ source: info.nodeId, handleId: info.handleId, flow, screen: { x: pt.clientX, y: pt.clientY } });
  }, [perms.canEdit, screenToFlowPosition]);

  const addQuickNode = useCallback((catalogKey: string) => {
    const qa = quickAdd; setQuickAdd(null);
    if (!qa || !perms.canEdit) return;
    const item = catalogByKey(catalogKey);
    if (!item) return;
    record();
    const cfg = JSON.parse(JSON.stringify(item.defaultConfig)) as Record<string, unknown>;
    const nk = makeKey(item.type);
    const newNode: Node = { id: nk, type: "journey", position: qa.flow, data: nodeData(item.type, cfg) };
    const src = nodesRef.current.find((n) => n.id === qa.source);
    const st = (src?.data as JourneyNodeData)?.nodeType;
    const plan = planConnection(fromRF(nodesRef.current, edgesRef.current).edges, { source: qa.source, target: nk, sourceHandle: qa.handleId, sourceType: st });
    setNodes((nds) => nds.concat(newNode));
    setEdges((eds) => {
      const kept = eds.filter((e) => !plan.replaces.includes(e.id));
      return kept.concat({
        id: makeKey("edge"), source: qa.source, target: nk, sourceHandle: qa.handleId ?? undefined,
        ...styleEdge(plan.branch_label), data: { branch_label: plan.branch_label ?? null },
      } as Edge);
    });
    setSelectedId(nk);
    markDirty();
  }, [quickAdd, perms.canEdit, record, setNodes, setEdges, markDirty]);

  const onReconnect = useCallback((oldEdge: Edge, conn: Connection) => {
    if (!perms.canEdit || !isValidConnection(conn)) return;
    const src = nodesRef.current.find((n) => n.id === conn.source);
    const st = (src?.data as JourneyNodeData)?.nodeType;
    const isBranchSrc = st === "condition" || st === "branch";
    const branch = isBranchSrc ? (conn.sourceHandle ?? null) : ((oldEdge.data as { branch_label?: string | null })?.branch_label ?? null);
    record();
    setEdges((eds) => reconnectEdge({ ...oldEdge, ...styleEdge(branch), data: { branch_label: branch } }, conn, eds));
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
    setNodes((nds) => nds.concat({ id: nk, type: "journey", position, data: nodeData(item.type, cfg) }));
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
      return { ...n, data: { ...d, ...nodeData(d.nodeType, config, tpl?.name), hasError: d.hasError, errorHint: d.errorHint } };
    }));
    markDirty();
  }, [selectedId, record, setNodes, templates, markDirty]);

  const deleteSelected = useCallback(() => {
    if (!perms.canEdit) return;
    if (selectedEdgeId) {
      record();
      setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
      setSelectedEdgeId(null); markDirty(); return;
    }
    if (!selectedId) return;
    record();
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
    markDirty();
  }, [selectedId, selectedEdgeId, perms.canEdit, record, setNodes, setEdges, markDirty]);

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

  const tidyUp = useCallback(() => {
    if (!perms.canEdit) return;
    record();
    const pos = tidyPositions(nodesRef.current, edgesRef.current);
    setNodes((nds) => nds.map((n) => pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n));
    markDirty();
    flash("Tidied up");
  }, [perms.canEdit, record, setNodes, markDirty, flash]);

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
      setFlags(res.flags ?? null); setKillSwitchEngaged(!!res.killSwitch?.engaged);
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
    const bad = new Map(rep.issues.filter((i) => i.nodeKey).map((i) => [i.nodeKey!, i.message]));
    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...(n.data as JourneyNodeData), hasError: bad.has(n.id), errorHint: bad.get(n.id) } })));
  }, [setNodes]);

  const runValidation = useCallback((g: BuilderGraph) => {
    const exec = executableGraph(g);
    return validateGraph(exec.nodes.map((n) => ({ node_key: n.node_key, type: n.type, config: n.config })), exec.edges.map((e) => ({ source: e.source, target: e.target, branch_label: e.branch_label })));
  }, []);

  const validate = useCallback(async () => {
    setBusy("validate");
    try {
      applyReport(runValidation(currentGraph()));
      const res = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/validate`, { method: "POST" }).then((r) => r.json());
      if (res?.ok) applyReport(res.report);
    } finally { setBusy(null); }
  }, [workflowId, currentGraph, applyReport, runValidation]);

  const publish = useCallback(async () => {
    if (!perms.canPublish) return;
    setBusy("publish");
    try {
      await fetch(`/api/admin/journey-automation/workflows/${workflowId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ graph: currentGraph() }) });
      const res = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeSummary: null }) }).then((r) => r.json());
      if (res?.ok) { setDirty(false); flash(`Published v${res.publishedVersion} — will run once execution is enabled`); await reload(); }
      else { if (res?.report) applyReport(res.report); flash(res?.error || "Publish blocked"); }
    } finally { setBusy(null); }
  }, [perms.canPublish, workflowId, currentGraph, flash, applyReport, reload]);

  const changeStatus = useCallback(async (action: "pause" | "resume" | "archive") => {
    if (!perms.canPause) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).then((r) => r.json());
      if (res?.ok) { flash(`Workflow ${action}d`); await reload(); } else flash(res?.error || "Action failed");
    } finally { setBusy(null); }
  }, [perms.canPause, workflowId, flash, reload]);

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
      else if ((e.key === "Delete" || e.key === "Backspace") && (selectedId || selectedEdgeId)) { e.preventDefault(); deleteSelected(); }
      else if (meta && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
      else if (e.key === "Escape") { setQuickAdd(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, duplicateSelected, deleteSelected, selectedId, selectedEdgeId, save]);

  // Live inline validation badges (before hitting Validate). Keyed on structure
  // only, so writing hasError back into nodes never re-triggers the pass.
  const graphSig = useMemo(
    () => JSON.stringify({
      n: nodes.map((n) => [n.id, (n.data as JourneyNodeData).nodeType, (n.data as JourneyNodeData & { config?: unknown }).config]),
      e: edges.map((e) => [e.source, e.target, e.sourceHandle ?? null]),
    }),
    [nodes, edges],
  );
  useEffect(() => {
    const rep = runValidation(fromRF(nodesRef.current, edgesRef.current));
    const bad = new Map<string, string>();
    for (const i of rep.issues) if (i.nodeKey && i.level === "error") bad.set(i.nodeKey, i.message);
    setNodes((nds) => {
      let changed = false;
      const next = nds.map((n) => {
        const cur = n.data as JourneyNodeData;
        const hint = bad.get(n.id);
        if (!!cur.hasError === !!hint && cur.errorHint === hint) return n;
        changed = true;
        return { ...n, data: { ...cur, hasError: !!hint, errorHint: hint } };
      });
      return changed ? next : nds;
    });
  }, [graphSig, runValidation, setNodes]);

  const selectedNode = useMemo(() => {
    const n = nodes.find((x) => x.id === selectedId);
    if (!n) return null;
    const d = n.data as JourneyNodeData & { config?: Record<string, unknown> };
    return { node_key: n.id, type: d.nodeType, config: (d.config ?? {}) as Record<string, unknown> };
  }, [nodes, selectedId]);

  const status = (workflow?.status ?? "draft") as WorkflowStatus;

  if (loading) return <div className="card p-10 text-center text-sm text-muted">Loading builder…</div>;
  if (!workflow) return <div className="card p-10 text-center text-sm text-muted">Workflow not found.</div>;

  return (
    <>
      {/* Toolbar */}
      <div className="ja-toolbar">
        <Link href="/admin/communications/journey-automation" className="ja-btn-sm" title="Back to journeys"><ArrowLeft size={15} /></Link>
        <span className="ja-toolbar-name" aria-label="Workflow name">{name || workflow.name}</span>
        <span className={`pill ${STATUS_PILL[status]}`}>{STATUS_LABEL[status]}</span>
        {(() => {
          const eff = effectiveJourneyState({
            mode: ((workflow.execution_mode ?? "off") as ExecutionMode),
            executionEnabled: !!flags?.executionEnabled,
            smsEnabled: !!flags?.smsEnabled,
            killSwitchEngaged,
          });
          return <span className={`pill ${effectiveTonePill(eff.tone)}`} title={eff.detail}>{eff.label}</span>;
        })()}
        <span className="text-xs text-muted">{workflow.published_version ? `Published v${workflow.published_version}` : "Never published"}{dirty ? " · Unsaved" : ""}</span>

        <div className="ja-toolbar-spacer" />

        <button className="ja-btn-sm" onClick={() => { setLeftCollapsed((v) => !v); refitSoon(); }} title={leftCollapsed ? "Show node library" : "Hide node library"} aria-pressed={leftCollapsed}>
          {leftCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        <button className="ja-btn-sm" onClick={() => { setRightCollapsed((v) => !v); refitSoon(); }} title={rightCollapsed ? "Show inspector" : "Hide inspector"} aria-pressed={rightCollapsed}>
          {rightCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
        </button>
        <button className="ja-btn-sm" onClick={undo} disabled={past.current.length === 0} title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
        <button className="ja-btn-sm" onClick={redo} disabled={future.current.length === 0} title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
        <button className="ja-btn-sm" onClick={tidyUp} disabled={!perms.canEdit} title="Tidy up layout"><Wand2 size={15} /> Tidy up</button>
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
            <button key={i} className="ja-report-item" style={{ color: iss.level === "error" ? "var(--danger)" : "var(--warning)", width: "100%", textAlign: "left" }}
              onClick={() => { if (iss.nodeKey) { setSelectedId(iss.nodeKey); setSelectedEdgeId(null); } }}>
              <AlertTriangle size={13} aria-hidden="true" /> <span>{iss.message}</span>
            </button>
          ))}
        </div>
      )}

      {/* Three-panel builder — full-bleed so it fills the viewport width and
          resizes live; palette + inspector are collapsible for max canvas. */}
      <div className="ja-fullbleed">
      <div className="ja-builder" ref={wrapRef} data-left={leftCollapsed ? "collapsed" : "open"} data-right={rightCollapsed ? "collapsed" : "open"}>
        {!leftCollapsed && <NodeLibrary disabled={!perms.canEdit} />}

        <div className="ja-canvas-wrap" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type === "position" && x.dragging === false)) markDirty(); }}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onReconnect={onReconnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_, n) => { setSelectedId(n.id); setSelectedEdgeId(null); }}
            onEdgeClick={(_, e) => { setSelectedEdgeId(e.id); setSelectedId(null); }}
            onPaneClick={() => { setSelectedId(null); setSelectedEdgeId(null); setQuickAdd(null); }}
            onNodeDragStart={() => record()}
            nodeTypes={nodeTypes}
            deleteKeyCode={null}
            snapToGrid
            snapGrid={[16, 16]}
            connectionRadius={38}
            fitView
            minZoom={0.2}
            maxZoom={1.75}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#c7d2e6" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={() => "#c7d6f0"} maskColor="rgba(10,31,68,0.06)" />
            {selectedEdgeId && perms.canEdit && (
              <Panel position="top-center">
                <button className="ja-btn-sm" data-variant="danger" onClick={deleteSelected} title="Delete selected connection"><Trash2 size={14} /> Delete connection</button>
              </Panel>
            )}
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="ja-empty-hint">
              <div>
                <p className="text-sm font-semibold">Drag a trigger here to begin</p>
                <p className="mt-1 text-xs">Build left-to-right. Drag from a node&apos;s dot to connect — for Yes/No, drag from the green (Yes) or red (No) dot. End every path in a Goal and an Exit.</p>
              </div>
            </div>
          )}

          {quickAdd && (
            <div className="ja-quickadd" style={{ left: Math.max(8, (quickAdd.screen.x - (wrapRef.current?.getBoundingClientRect().left ?? 0)) - 90), top: (quickAdd.screen.y - (wrapRef.current?.getBoundingClientRect().top ?? 0)) - 10 }}
              onMouseLeave={() => setQuickAdd(null)}>
              <div className="ja-quickadd-head">Add next step {quickAdd.handleId ? `(${branchDisplayLabel(quickAdd.handleId)})` : ""}</div>
              {QUICK_ADD_ITEMS.map((it) => (
                <button key={it.key} className="ja-quickadd-item" onClick={() => addQuickNode(it.key)}>
                  <BuilderIcon name={it.icon} size={14} /> {it.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {!rightCollapsed && (
          <NodeInspector node={selectedNode} templates={templates} triggerSources={triggerSources} canEdit={perms.canEdit} onChange={updateSelectedConfig} onDelete={deleteSelected} />
        )}
      </div>
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
