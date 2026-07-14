/**
 * Pure graph traversal over an immutable published workflow definition
 * (BuilderGraph snapshot). No IO. Used by the matcher (find entry) and the worker
 * (advance from a node, pick condition/branch edges).
 */
import type { BuilderGraph, BuilderNode, BuilderEdge } from "@/types/journey-automation";

export function parseGraph(def: unknown): BuilderGraph {
  const g = (def ?? {}) as Partial<BuilderGraph>;
  return {
    nodes: Array.isArray(g.nodes) ? (g.nodes as BuilderNode[]) : [],
    edges: Array.isArray(g.edges) ? (g.edges as BuilderEdge[]) : [],
  };
}

export function nodeByKey(g: BuilderGraph, key: string): BuilderNode | null {
  return g.nodes.find((n) => n.node_key === key) ?? null;
}

export function triggerNode(g: BuilderGraph): BuilderNode | null {
  return g.nodes.find((n) => n.type === "trigger") ?? null;
}

export function goalNode(g: BuilderGraph): BuilderNode | null {
  return g.nodes.find((n) => n.type === "goal") ?? null;
}

export function outgoingEdges(g: BuilderGraph, key: string): BuilderEdge[] {
  return g.edges.filter((e) => e.source === key);
}

/**
 * The next node key(s) to schedule after `fromKey`. For condition/branch nodes,
 * `branch` selects the matching labelled edge ('yes'/'no' or a branch label);
 * when no labelled edge matches, falls back to unlabelled edges.
 */
export function nextNodeKeys(g: BuilderGraph, fromKey: string, branch?: string | null): string[] {
  const edges = outgoingEdges(g, fromKey);
  if (branch != null) {
    const norm = String(branch).toLowerCase();
    const labelled = edges.filter((e) => (e.branch_label ?? "").toLowerCase() === norm);
    if (labelled.length > 0) return labelled.map((e) => e.target);
    // fall back to unlabelled edges only
    return edges.filter((e) => !e.branch_label).map((e) => e.target);
  }
  return edges.map((e) => e.target);
}

/** The first node to execute after the trigger (or the trigger itself if terminal). */
export function entryNodeKey(g: BuilderGraph): string | null {
  const t = triggerNode(g);
  if (!t) return null;
  const next = nextNodeKeys(g, t.node_key);
  return next[0] ?? t.node_key;
}
