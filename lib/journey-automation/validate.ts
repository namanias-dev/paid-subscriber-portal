/**
 * Pure pre-publish validation for a Journey Automation draft graph.
 *
 * No I/O — takes the node/edge snapshot and returns a structured report so the API
 * and unit tests share one source of truth. Validation is authoring-only; it never
 * sends or executes anything.
 */

export type ValidationLevel = "error" | "warning";

export interface ValidationIssue {
  level: ValidationLevel;
  code: string;
  message: string;
  nodeKey?: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
}

export interface GraphNode {
  node_key: string;
  type: string;
  config: Record<string, unknown>;
}

export interface GraphEdge {
  source: string; // node_key
  target: string; // node_key
  branch_label?: string | null;
}

const TRIGGER = "trigger";
const GOAL = "goal";
const EXIT = "exit";
const WAIT = "wait";
const SMS = "send_sms";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Reachable set from any trigger node, following outgoing edges. */
function reachableFromTriggers(nodes: GraphNode[], edges: GraphEdge[]): Set<string> {
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const arr = out.get(e.source) ?? [];
    arr.push(e.target);
    out.set(e.source, arr);
  }
  const seen = new Set<string>();
  const stack = nodes.filter((n) => n.type === TRIGGER).map((n) => n.node_key);
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nxt of out.get(cur) ?? []) if (!seen.has(nxt)) stack.push(nxt);
  }
  return seen;
}

/**
 * Detect a cycle that does NOT pass through a Wait node — an "obvious infinite
 * loop" (a timing-less cycle would spin instantly once execution ships).
 */
function hasWaitlessCycle(nodes: GraphNode[], edges: GraphEdge[]): boolean {
  const typeByKey = new Map(nodes.map((n) => [n.node_key, n.type]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const arr = out.get(e.source) ?? [];
    arr.push(e.target);
    out.set(e.source, arr);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.node_key, WHITE);

  const dfs = (u: string): boolean => {
    color.set(u, GRAY);
    for (const v of out.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      // A back-edge to a GRAY node closes a cycle. If neither endpoint region
      // contains a Wait, treat it as a waitless (obvious infinite) loop.
      if (c === GRAY) {
        if (typeByKey.get(u) !== WAIT && typeByKey.get(v) !== WAIT) return true;
      } else if (c === WHITE) {
        if (dfs(v)) return true;
      }
    }
    color.set(u, BLACK);
    return false;
  };

  for (const n of nodes) {
    if ((color.get(n.node_key) ?? WHITE) === WHITE) {
      if (dfs(n.node_key)) return true;
    }
  }
  return false;
}

export function validateGraph(nodes: GraphNode[], edges: GraphEdge[]): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (level: ValidationLevel, code: string, message: string, nodeKey?: string) =>
    issues.push({ level, code, message, nodeKey });

  const triggers = nodes.filter((n) => n.type === TRIGGER);
  const goals = nodes.filter((n) => n.type === GOAL);
  const exits = nodes.filter((n) => n.type === EXIT);

  // Empty graph.
  if (nodes.length === 0) {
    add("error", "empty", "The journey is empty. Add a trigger to begin.");
    return summarize(issues);
  }

  // Trigger exists.
  if (triggers.length === 0) add("error", "no_trigger", "Add a Trigger node — a journey needs an entry point.");

  // Goal + exit present.
  if (goals.length === 0) add("error", "no_goal", "Add a Goal node so the journey has a measurable outcome.");
  if (exits.length === 0) add("error", "no_exit", "Add a Stop / Exit node so every path can end cleanly.");

  // Reachability: no disconnected required nodes.
  const reachable = reachableFromTriggers(nodes, edges);
  for (const n of nodes) {
    if (n.type === TRIGGER) continue;
    if (!reachable.has(n.node_key)) {
      add("error", "disconnected", `"${labelOf(n)}" is not connected to any trigger path.`, n.node_key);
    }
  }

  // At least one valid path trigger -> (goal or exit).
  const endpoints = new Set([...goals, ...exits].map((n) => n.node_key));
  const hasPath = [...reachable].some((k) => endpoints.has(k));
  if (triggers.length > 0 && endpoints.size > 0 && !hasPath) {
    add("error", "no_path", "No complete path from a trigger to a goal or exit.");
  }

  // No obvious infinite loop.
  if (hasWaitlessCycle(nodes, edges)) {
    add("error", "infinite_loop", "A loop has no Wait step — add a Wait or an exit to avoid an infinite loop.");
  }

  // Communications (SMS) node checks.
  const outByKey = new Map<string, number>();
  for (const e of edges) outByKey.set(e.source, (outByKey.get(e.source) ?? 0) + 1);
  for (const n of nodes) {
    if (n.type !== SMS) continue;
    const c = asRecord(n.config);
    if (!c.automationTemplateId) {
      add("error", "sms_no_template", `"${labelOf(n)}" needs an approved DLT template.`, n.node_key);
    }
    const vars = Array.isArray(c.templateVariables) ? (c.templateVariables as string[]) : [];
    const mapping = asRecord(c.variableMapping);
    const missing = vars.filter((v) => !mapping[v] || String(mapping[v]).trim() === "");
    if (missing.length) {
      add("error", "sms_unmapped_vars", `"${labelOf(n)}" is missing variable mapping: ${missing.join(", ")}.`, n.node_key);
    }
    if (!c.frequencyCap) add("warning", "sms_no_freq_cap", `"${labelOf(n)}" has no frequency cap configured.`, n.node_key);
    if (!c.quietHours) add("warning", "sms_no_quiet_hours", `"${labelOf(n)}" has no quiet-hours configured.`, n.node_key);
  }

  // Non-terminal nodes should have an outgoing edge.
  for (const n of nodes) {
    if (n.type === EXIT || n.type === GOAL) continue;
    if ((outByKey.get(n.node_key) ?? 0) === 0) {
      add("warning", "dangling", `"${labelOf(n)}" has no next step.`, n.node_key);
    }
  }

  // Condition nodes need both a Yes and a No path so neither outcome dead-ends.
  const labelsBySource = new Map<string, Set<string>>();
  for (const e of edges) {
    const set = labelsBySource.get(e.source) ?? new Set<string>();
    set.add(String(e.branch_label ?? "").toLowerCase());
    labelsBySource.set(e.source, set);
  }
  for (const n of nodes) {
    if (n.type === "condition") {
      const labels = labelsBySource.get(n.node_key) ?? new Set<string>();
      if (!labels.has("yes")) add("error", "condition_no_yes", `"${labelOf(n)}" is missing a Yes path.`, n.node_key);
      if (!labels.has("no")) add("error", "condition_no_no", `"${labelOf(n)}" is missing a No path.`, n.node_key);
    }
    if (n.type === "branch") {
      const branches = asRecord(n.config)["branches"];
      const labels = labelsBySource.get(n.node_key) ?? new Set<string>();
      if (Array.isArray(branches)) {
        for (const b of branches) {
          const lbl = String((typeof b === "string" ? b : (b as Record<string, unknown>)?.["label"]) ?? "").toLowerCase();
          if (lbl && !labels.has(lbl)) add("warning", "branch_no_edge", `"${labelOf(n)}" path "${lbl}" has no connected step.`, n.node_key);
        }
      }
    }
  }

  return summarize(issues);
}

function labelOf(n: GraphNode): string {
  const c = asRecord(n.config);
  return (typeof c.title === "string" && c.title) || (typeof c.label === "string" && c.label) || n.type;
}

function summarize(issues: ValidationIssue[]): ValidationReport {
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  return { ok: errors === 0, errors, warnings, issues };
}
