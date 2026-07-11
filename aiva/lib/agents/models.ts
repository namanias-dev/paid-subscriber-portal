import { getSupabase } from "../supabase";
import { getRevenueTower } from "../revenue/tower";
import { inr } from "../revenue/dailyBrief";
import { AGENTS, agentById, type AgentMeta } from "./registry";
import type { Risk } from "../flags";
import { canExecute } from "../flags";

/**
 * Per-agent read models. Metrics come from real data. Recommendations are DRAFTS ONLY — each
 * carries a risk level and an `executable` flag that reflects the current feature-flag posture
 * (all amber/red actions are disabled in the read-only first release).
 */

export type Metric = { label: string; value: string; hint?: string };

export type Recommendation = {
  id: string;
  title: string;
  rationale: string;
  risk: Risk;
  tool?: string;
  executable: boolean;
  blockedReason?: string;
};

export type AgentSnapshot = {
  agent: AgentMeta;
  metrics: Metric[];
  recommendations: Recommendation[];
  note?: string;
};

function rec(r: Omit<Recommendation, "executable" | "blockedReason">): Recommendation {
  const gate = canExecute(r.risk);
  return { ...r, executable: gate.allowed, blockedReason: gate.reason };
}

async function count(table: string, apply?: (q: any) => any): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  try {
    let q = sb.from(table).select("id", { count: "exact", head: true });
    if (apply) q = apply(q);
    const { count } = await q;
    return count || 0;
  } catch {
    return 0;
  }
}

export async function getAgentSnapshot(id: string): Promise<AgentSnapshot | null> {
  const agent = agentById(id);
  if (!agent) return null;

  switch (id) {
    case "revenue": {
      const t = await getRevenueTower();
      return {
        agent,
        metrics: [
          { label: "Collected", value: inr(t.collected) },
          { label: "Outstanding", value: inr(t.outstanding) },
          { label: "Overdue (all)", value: inr(t.overdueTotal.amount), hint: `${t.overdueTotal.count} lines` },
          { label: "At-risk", value: inr(t.atRiskRevenue) },
          { label: "Proofs pending", value: String(t.proofsPending) },
          { label: "Abandoned", value: inr(t.abandoned.amount), hint: `${t.abandoned.count}` },
        ],
        recommendations: [
          t.overdueTotal.count > 0
            ? rec({
                id: "draft-overdue-reminders",
                title: `Prepare reminders for ${t.overdueTotal.count} overdue installment(s)`,
                rationale: `${inr(t.overdueTotal.amount)} is overdue. Reminders would exclude paid/proof-approved and opted-out numbers.`,
                risk: "amber",
                tool: "prepare_sms_campaign",
              })
            : null,
          t.proofsPending > 0
            ? rec({
                id: "review-proofs",
                title: `Review ${t.proofsPending} pending payment proof(s)`,
                rationale: "Proof review is a staff action in the portal; AIVA only surfaces the backlog.",
                risk: "green",
              })
            : null,
          t.paidWithoutActiveEnrollment > 0
            ? rec({
                id: "reconcile-access",
                title: `Reconcile ${t.paidWithoutActiveEnrollment} paid-without-enrollment case(s)`,
                rationale: "Paid course payments with no active enrollment may indicate an access or ledger gap.",
                risk: "red",
              })
            : null,
        ].filter(Boolean) as Recommendation[],
      };
    }

    case "admissions": {
      const leads = await count("leads");
      const uncontacted = await count("leads", (q) => q.eq("called", false));
      const webinarRegs = await count("webinar_registrations");
      return {
        agent,
        metrics: [
          { label: "Total leads", value: String(leads) },
          { label: "Uncontacted", value: String(uncontacted) },
          { label: "Webinar registrants", value: String(webinarRegs) },
        ],
        recommendations: [
          uncontacted > 0
            ? rec({
                id: "prioritize-leads",
                title: `Prioritize ${uncontacted} uncontacted lead(s)`,
                rationale: "Uncontacted leads decay fast. AIVA can draft a counselor call list (read-only preview).",
                risk: "amber",
                tool: "create_staff_call_tasks",
              })
            : null,
        ].filter(Boolean) as Recommendation[],
      };
    }

    case "marketing": {
      const optOuts = await count("sms_opt_outs");
      const templates = await count("sms_templates", (q) => q.eq("is_active", true));
      return {
        agent,
        metrics: [
          { label: "Active SMS templates", value: String(templates) },
          { label: "Opt-outs (suppressed)", value: String(optOuts) },
        ],
        recommendations: [
          rec({
            id: "campaigns-disabled",
            title: "Campaign engine is disabled",
            rationale: "AIVA_CAMPAIGNS_ENABLED=false. Campaign drafting/sending stays off until preview validation is complete.",
            risk: "amber",
            tool: "prepare_sms_campaign",
          }),
        ],
        note: "Marketing actions are disabled in the first release. Segments and drafts will appear here once enabled.",
      };
    }

    case "operations": {
      const failedSms = await count("sms_logs", (q) => q.eq("status", "FAILED"));
      const openProofs = await count("payment_proofs", (q) => q.in("status", ["submitted", "reupload_requested"]));
      return {
        agent,
        metrics: [
          { label: "Failed SMS", value: String(failedSms) },
          { label: "Open proofs", value: String(openProofs) },
        ],
        recommendations: [],
      };
    }

    case "student_success": {
      const enrollments = await count("course_enrollments");
      return {
        agent,
        metrics: [{ label: "Enrollments", value: String(enrollments) }],
        recommendations: [],
        note: "Engagement/at-risk detection reads class-hub and quiz activity; deeper models arrive in a later phase.",
      };
    }

    case "content": {
      const articles = await count("ca_articles", (q) => q.eq("status", "published"));
      const resources = await count("resources", (q) => q.eq("status", "published"));
      return {
        agent,
        metrics: [
          { label: "Published CA articles", value: String(articles) },
          { label: "Published resources", value: String(resources) },
        ],
        recommendations: [],
      };
    }

    case "batch_launch": {
      const courses = await count("courses", (q) => q.eq("status", "published"));
      const webinars = await count("webinars", (q) => q.eq("status", "upcoming"));
      return {
        agent,
        metrics: [
          { label: "Published courses", value: String(courses) },
          { label: "Upcoming webinars", value: String(webinars) },
        ],
        recommendations: [
          rec({
            id: "duplicate-disabled",
            title: "Batch duplication is draft-only and disabled",
            rationale: "Duplicating a course/webinar as a draft is an amber action, disabled in read-only mode.",
            risk: "amber",
            tool: "duplicate_course_as_draft",
          }),
        ],
      };
    }

    case "analytics": {
      const t = await getRevenueTower();
      return {
        agent,
        metrics: [
          { label: "Collected", value: inr(t.collected) },
          { label: "Expected", value: inr(t.expected) },
          { label: "Active enrollments", value: String(t.activeEnrollments) },
        ],
        recommendations: [],
      };
    }

    case "security": {
      const admins = await count("admin_users", (q) => q.eq("status", "active"));
      return {
        agent,
        metrics: [{ label: "Active admin accounts", value: String(admins) }],
        recommendations: [],
        note: "Security monitors audit logs and approval integrity. AIVA writes its own immutable audit log for every action attempt.",
      };
    }

    case "codebase_intelligence": {
      return {
        agent,
        metrics: [
          { label: "Registries", value: "13" },
          { label: "Snapshots", value: String(await count("aiva_codebase_snapshots")) },
        ],
        recommendations: [],
        note: "See /aiva/codebase-intelligence for the full registry.",
      };
    }

    default:
      return { agent, metrics: [], recommendations: [] };
  }
}

export function allAgents(): AgentMeta[] {
  return AGENTS;
}

export type InboxItem = Recommendation & { agent: string; agentName: string };

/** Aggregate draft recommendations that would require approval, for the Approval Inbox. */
export async function getApprovalInbox(): Promise<InboxItem[]> {
  const domains = ["revenue", "admissions", "marketing", "batch_launch"];
  const out: InboxItem[] = [];
  for (const d of domains) {
    const snap = await getAgentSnapshot(d);
    if (!snap) continue;
    for (const r of snap.recommendations) {
      if (r.risk !== "green") out.push({ ...r, agent: snap.agent.id, agentName: snap.agent.name });
    }
  }
  return out;
}
