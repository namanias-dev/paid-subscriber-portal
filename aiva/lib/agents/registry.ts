import type { EventDomain } from "../events/catalog";

export type AgentMeta = {
  id: EventDomain;
  name: string;
  blurb: string;
  color: string; // hex for the Neural Core node
  href: string;
};

/** The AIVA agent network — one node per domain agent on the Neural Core. */
export const AGENTS: AgentMeta[] = [
  { id: "revenue", name: "Revenue", blurb: "Stuck revenue, overdue installments, proof backlog, recovery.", color: "#16a34a", href: "/aiva/revenue" },
  { id: "admissions", name: "Admissions", blurb: "Hot leads, webinar registrants, counselor briefs.", color: "#f2c94c", href: "/aiva/admissions" },
  { id: "marketing", name: "Marketing", blurb: "Segments, offers, campaign drafts, attribution.", color: "#a855f7", href: "/aiva/marketing" },
  { id: "student_success", name: "Student Success", blurb: "Inactive paid students, engagement, at-risk.", color: "#38bdf8", href: "/aiva/student-success" },
  { id: "content", name: "Content", blurb: "Current affairs, resources, quizzes, CTAs.", color: "#22d3ee", href: "/aiva/content" },
  { id: "batch_launch", name: "Batch Launch", blurb: "Duplicate courses/webinars as drafts, launch checklist.", color: "#fb923c", href: "/aiva/batch-launch" },
  { id: "operations", name: "Operations", blurb: "Proof queue, SMS failures, cron health, assets.", color: "#fbbf24", href: "/aiva/system-health" },
  { id: "analytics", name: "Analytics", blurb: "KPIs, funnels, trends, anomalies, forecasts.", color: "#0057ff", href: "/aiva/analytics" },
  { id: "security", name: "Security", blurb: "Audit log, unusual actions, PII, approval integrity.", color: "#dc2626", href: "/aiva/security" },
  { id: "codebase_intelligence", name: "Codebase Intelligence", blurb: "Repo map, registries, change-impact, freshness.", color: "#e8ecf6", href: "/aiva/codebase-intelligence" },
];

export function agentById(id: string): AgentMeta | undefined {
  return AGENTS.find((a) => a.id === id);
}
