/**
 * PURE graph <-> canvas mapping for the visual builder. No @xyflow/react import,
 * so it is safe to unit-test and never pulls the canvas lib into any bundle.
 *
 * The engine reads edges by lowercase `branch_label` (see engine/graph.ts). The
 * canvas carries the same semantics on the edge `sourceHandle`. These helpers are
 * the single source of truth that keeps the two in sync across save/reload:
 *   - condition/branch nodes expose one labelled output HANDLE per branch;
 *   - an edge's sourceHandle == its branch_label (lowercase);
 *   - everything else uses the default (unlabelled) handle.
 *
 * Notes (type "note") are non-executable annotations: they never carry edges and
 * are excluded from validation + the engine.
 */
import type { BuilderGraph, BuilderNode, BuilderEdge } from "@/types/journey-automation";

/** Node types that fan out along multiple LABELLED handles. */
export const MULTI_HANDLE_TYPES = new Set(["condition", "branch"]);

export function isNoteType(type: string | null | undefined): boolean {
  return type === "note";
}

/** The output handle ids a node exposes (empty => single default handle). */
export function outputHandles(node: Pick<BuilderNode, "type" | "config">): string[] {
  if (node.type === "condition") return ["yes", "no"];
  if (node.type === "branch") {
    const raw = (node.config?.["branches"] ?? []) as unknown[];
    const labels = raw
      .map((b) => (typeof b === "string" ? b : (b as Record<string, unknown>)?.["label"]))
      .map((l) => String(l ?? "").trim().toLowerCase())
      .filter(Boolean);
    return labels.length ? labels : ["a", "b"];
  }
  return [];
}

/** Human label shown on a branch edge/handle. */
export function branchDisplayLabel(handle: string): string {
  if (handle === "yes") return "Yes";
  if (handle === "no") return "No";
  return handle.toUpperCase();
}

// --- Minimal canvas shapes (structurally compatible with @xyflow Node/Edge) ---
export interface RFNodeLite {
  id: string;
  position: { x: number; y: number };
  data: { nodeType: string; config: Record<string, unknown>; [k: string]: unknown };
}
export interface RFEdgeLite {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  data?: { branch_label?: string | null; condition?: Record<string, unknown> } | undefined;
}

/** Map a stored graph edge -> canvas edge (sourceHandle carries the branch). */
export function edgeToRF(e: BuilderEdge, sourceType: string | undefined): RFEdgeLite {
  const isBranchSource = MULTI_HANDLE_TYPES.has(sourceType ?? "");
  const handle = isBranchSource ? (e.branch_label ?? null) : null;
  return {
    id: e.edge_key,
    source: e.source,
    target: e.target,
    sourceHandle: handle,
    data: { branch_label: e.branch_label ?? null, condition: e.condition ?? {} },
  };
}

/** Map a canvas edge -> stored graph edge (branch_label from the handle). */
export function edgeFromRF(e: RFEdgeLite, sourceType: string | undefined): BuilderEdge {
  const isBranchSource = MULTI_HANDLE_TYPES.has(sourceType ?? "");
  const branch_label = isBranchSource
    ? (e.sourceHandle ?? e.data?.branch_label ?? null)
    : (e.data?.branch_label ?? null);
  return {
    edge_key: e.id,
    source: e.source,
    target: e.target,
    branch_label: branch_label ? String(branch_label).toLowerCase() : null,
    condition: e.data?.condition ?? {},
  };
}

/** Whole-graph round-trip helpers (used by tests + the builder). */
export function graphEdgesToRF(graph: BuilderGraph): RFEdgeLite[] {
  const typeByKey = new Map(graph.nodes.map((n) => [n.node_key, n.type]));
  return graph.edges.map((e) => edgeToRF(e, typeByKey.get(e.source)));
}

export function graphEdgesFromRF(edges: RFEdgeLite[], nodes: Pick<BuilderNode, "node_key" | "type">[]): BuilderEdge[] {
  const typeByKey = new Map(nodes.map((n) => [n.node_key, n.type]));
  return edges.map((e) => edgeFromRF(e, typeByKey.get(e.source)));
}

/**
 * Would adding source->target introduce a directed cycle? Keeps the graph acyclic
 * (the engine model requires it). Notes are irrelevant here (they have no edges).
 */
export function wouldCreateCycle(edges: Pick<BuilderEdge, "source" | "target">[], source: string, target: string): boolean {
  if (source === target) return true;
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const arr = out.get(e.source) ?? [];
    arr.push(e.target);
    out.set(e.source, arr);
  }
  // Does target already reach source? If so, source->target closes a loop.
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nxt of out.get(cur) ?? []) stack.push(nxt);
  }
  return false;
}

export interface ConnectInput {
  source: string;
  target: string;
  sourceHandle?: string | null;
  sourceType?: string;
}
export interface ConnectResult {
  ok: boolean;
  reason?: string;
  branch_label: string | null;
  /** Edge ids on the same (source, handle) that this connection REPLACES. */
  replaces: string[];
}

/**
 * Decide a new connection against the current edges. Enforces:
 *  - acyclic (no cycle),
 *  - exactly ONE edge per (source, handle): a new edge on an occupied handle
 *    REPLACES the old one (forgiving, not a silent no-op),
 *  - no duplicate identical edge.
 * Returns the branch_label to persist + which edges to remove first.
 */
export function planConnection(edges: Pick<BuilderEdge, "edge_key" | "source" | "target" | "branch_label">[], input: ConnectInput): ConnectResult {
  const isBranchSource = MULTI_HANDLE_TYPES.has(input.sourceType ?? "");
  const handle = isBranchSource ? (input.sourceHandle ? String(input.sourceHandle).toLowerCase() : null) : null;
  if (input.source === input.target) return { ok: false, reason: "A step cannot connect to itself.", branch_label: handle, replaces: [] };
  if (wouldCreateCycle(edges, input.source, input.target)) {
    return { ok: false, reason: "That would create a loop. Journeys must flow forward to a Goal or Exit.", branch_label: handle, replaces: [] };
  }
  // One edge per handle on the source.
  const sameHandle = edges.filter((e) => e.source === input.source && (isBranchSource ? (e.branch_label ?? null) === handle : true));
  const replaces = sameHandle.map((e) => e.edge_key);
  return { ok: true, branch_label: handle, replaces };
}

/** All nodes/edges relevant to VALIDATION + ENGINE (notes excluded). */
export function executableGraph(graph: BuilderGraph): BuilderGraph {
  const nodes = graph.nodes.filter((n) => !isNoteType(n.type));
  const keys = new Set(nodes.map((n) => n.node_key));
  const edges = graph.edges.filter((e) => keys.has(e.source) && keys.has(e.target));
  return { nodes, edges };
}
