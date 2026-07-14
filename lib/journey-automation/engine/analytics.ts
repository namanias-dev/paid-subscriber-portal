/**
 * P6 — ANALYTICS & ATTRIBUTION. READ-ONLY over engine tables + existing payment
 * truth. Revenue is NEVER a separate money source: it is computed from
 * deriveCollections (the existing ledger derive), so it reconciles by construction.
 *
 * ATTRIBUTION RULE (explicit + conservative):
 *   An enrollment is revenue-attributed to a workflow IFF
 *     (a) it reached status 'goal_met' with a PAYMENT-type goal, AND
 *     (b) it converted within the attribution window (default 30 days of entry), AND
 *     (c) its linked course_enrollment shows paid > 0 (from deriveCollections).
 *   Attributed revenue = Σ deriveCollections(courseEnrollment).paid over the UNIQUE
 *   attributed course_enrollment ids (deduped → no double count within the workflow).
 *   We do NOT count checkout attempts; only ledger-derived paid. Cross-workflow
 *   last-touch is out of scope (each workflow reports its own attributable set).
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { deriveCollections } from "@/lib/installments";
import type { CourseEnrollment } from "@/lib/types";
import type { EnrollmentRow, NodeRunRow } from "./types";

export const PAYMENT_GOAL_TYPES = new Set(["payment_completed", "payment_received", "installment_paid", "fully_paid"]);
export const DEFAULT_ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60_000;

export interface AttributableEnrollment {
  enrollmentRef: string | null;
  enrolledAt: number;
  completedAt: number | null;
  goalMet: boolean;
  goalType: string | null;
}

export interface RevenueSource { id: string; paid: number }

export interface AttributionResult {
  attributedRevenue: number;
  attributedCount: number;
  attributedRefs: string[];
}

/**
 * PURE attribution. Sums deriveCollections-derived `paid` over unique attributed
 * course_enrollment refs. Testable + reconciles to deriveCollections by design.
 */
export function attributeRevenue(
  enrollments: AttributableEnrollment[],
  sources: RevenueSource[],
  windowMs = DEFAULT_ATTRIBUTION_WINDOW_MS,
): AttributionResult {
  const paidByRef = new Map(sources.map((s) => [s.id, s.paid]));
  const attributedRefs = new Set<string>();
  let attributedCount = 0;
  for (const e of enrollments) {
    if (!e.goalMet) continue;
    if (!e.goalType || !PAYMENT_GOAL_TYPES.has(e.goalType)) continue;
    if (e.completedAt == null) continue;
    if (e.completedAt < e.enrolledAt || e.completedAt > e.enrolledAt + windowMs) continue;
    if (!e.enrollmentRef) continue;
    const paid = paidByRef.get(e.enrollmentRef) ?? 0;
    if (paid <= 0) continue;
    attributedCount++;
    attributedRefs.add(e.enrollmentRef);
  }
  let attributedRevenue = 0;
  for (const ref of attributedRefs) attributedRevenue += paidByRef.get(ref) ?? 0;
  return { attributedRevenue, attributedCount, attributedRefs: [...attributedRefs] };
}

export interface NodeStat { node_key: string; node_type: string; entered: number; passed: number; suppressed: number; simulated: number; sent: number; failed: number }

export interface WorkflowAnalytics {
  workflowId: string;
  funnel: { entered: number; active: number; completed: number; converted: number; exitedEarly: number; failed: number };
  messages: { wouldSend: number; sent: number; suppressed: number };
  goalConversions: number;
  conversionRatePct: number;
  avgConversionHours: number | null;
  revenue: { attributed: number; attributedCount: number; source: "deriveCollections"; note: string };
  costs: { smsCost: number; revenuePer1000: number | null; rocs: number | null; note: string };
  nodeStats: NodeStat[];
  generatedAt: string;
}

const GOAL_TYPE_FROM_GRAPH = (graphDef: unknown): string | null => {
  const g = (graphDef ?? {}) as { nodes?: Array<{ type?: string; config?: Record<string, unknown> }> };
  const goal = (g.nodes ?? []).find((n) => n.type === "goal");
  const t = goal?.config?.["goal_type"] ?? goal?.config?.["goalType"];
  return typeof t === "string" ? t : null;
};

export async function computeWorkflowAnalytics(workflowId: string, windowMs = DEFAULT_ATTRIBUTION_WINDOW_MS): Promise<WorkflowAnalytics> {
  const nowISO = new Date().toISOString();
  const base: WorkflowAnalytics = {
    workflowId,
    funnel: { entered: 0, active: 0, completed: 0, converted: 0, exitedEarly: 0, failed: 0 },
    messages: { wouldSend: 0, sent: 0, suppressed: 0 },
    goalConversions: 0, conversionRatePct: 0, avgConversionHours: null,
    revenue: { attributed: 0, attributedCount: 0, source: "deriveCollections", note: "Simulation: conversions are real ledger state, not caused by sends (nothing sends)." },
    costs: { smsCost: 0, revenuePer1000: null, rocs: null, note: "0/NA in simulation (no live sends)." },
    nodeStats: [], generatedAt: nowISO,
  };
  const sb = getSupabaseAdmin();
  if (!sb) return base;

  const { data: ver } = await sb.from("automation_workflow_versions").select("definition")
    .eq("workflow_id", workflowId).eq("status", "published").order("version", { ascending: false }).limit(1).maybeSingle();
  const goalType = ver ? GOAL_TYPE_FROM_GRAPH((ver as { definition: unknown }).definition) : null;

  const { data: enrRows } = await sb.from("automation_enrollments").select("*").eq("workflow_id", workflowId);
  const enrollments = (enrRows ?? []) as EnrollmentRow[];
  base.funnel.entered = enrollments.length;
  let convTimeSum = 0, convTimeN = 0;
  for (const e of enrollments) {
    if (e.status === "active") base.funnel.active++;
    else if (e.status === "completed") base.funnel.completed++;
    else if (e.status === "goal_met") { base.funnel.converted++; base.goalConversions++; }
    else if (e.status === "exited" || e.status === "cancelled") base.funnel.exitedEarly++;
    else if (e.status === "failed") base.funnel.failed++;
    if (e.status === "goal_met" && e.completed_at) {
      const dt = new Date(e.completed_at).getTime() - new Date(e.enrolled_at).getTime();
      if (dt >= 0) { convTimeSum += dt; convTimeN++; }
    }
  }
  base.conversionRatePct = base.funnel.entered > 0 ? Math.round((base.funnel.converted / base.funnel.entered) * 1000) / 10 : 0;
  base.avgConversionHours = convTimeN > 0 ? Math.round((convTimeSum / convTimeN) / 3_600_000 * 10) / 10 : null;

  // Node-run aggregates → funnel messages + per-node stats.
  const { data: nrRows } = await sb.from("automation_node_runs").select("node_key, node_type, status").eq("workflow_id", workflowId);
  const statMap = new Map<string, NodeStat>();
  for (const r of (nrRows ?? []) as Pick<NodeRunRow, "node_key" | "node_type" | "status">[]) {
    const s = statMap.get(r.node_key) ?? { node_key: r.node_key, node_type: r.node_type, entered: 0, passed: 0, suppressed: 0, simulated: 0, sent: 0, failed: 0 };
    s.entered++;
    if (r.status === "suppressed") s.suppressed++;
    else if (r.status === "simulated") { s.simulated++; s.passed++; }
    else if (r.status === "sent") { s.sent++; s.passed++; }
    else if (r.status === "failed") s.failed++;
    else s.passed++;
    statMap.set(r.node_key, s);
    if (r.node_type === "send_sms") {
      if (r.status === "simulated") base.messages.wouldSend++;
      else if (r.status === "sent") base.messages.sent++;
      else if (r.status === "suppressed") base.messages.suppressed++;
    }
  }
  base.nodeStats = [...statMap.values()];

  // Revenue attribution — deriveCollections is the ONLY money source.
  const converted = enrollments.filter((e) => e.status === "goal_met" && e.enrollment_ref);
  const refs = [...new Set(converted.map((e) => e.enrollment_ref as string))];
  const sources: RevenueSource[] = [];
  if (refs.length > 0) {
    const { data: cRows } = await sb.from("course_enrollments").select("*").in("id", refs);
    for (const ce of (cRows ?? []) as CourseEnrollment[]) {
      sources.push({ id: ce.id, paid: deriveCollections(ce).paid });
    }
  }
  const attributable: AttributableEnrollment[] = converted.map((e) => ({
    enrollmentRef: e.enrollment_ref, enrolledAt: new Date(e.enrolled_at).getTime(),
    completedAt: e.completed_at ? new Date(e.completed_at).getTime() : null,
    goalMet: e.status === "goal_met", goalType,
  }));
  const attr = attributeRevenue(attributable, sources, windowMs);
  base.revenue.attributed = attr.attributedRevenue;
  base.revenue.attributedCount = attr.attributedCount;
  if (base.messages.sent > 0) base.costs.revenuePer1000 = Math.round((attr.attributedRevenue / base.messages.sent) * 1000);
  return base;
}
