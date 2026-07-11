import { canExecute, type Risk } from "../flags";
import { writeAudit } from "../audit";
import type { AivaSession } from "../session";

/**
 * Allowlisted tool registry. AIVA agents may only invoke tools defined here. Tools are either
 * read-only (implemented) or draft/mutating (execution DISABLED in the read-only first release).
 * There is intentionally NO arbitrary-SQL / payment-mutation / bulk-send tool.
 */

export type ToolDef = {
  name: string;
  risk: Risk;
  readonly: boolean;
  implemented: boolean;
  description: string;
  flag?: string;
};

export const TOOLS: ToolDef[] = [
  { name: "get_ceo_daily_brief", risk: "green", readonly: true, implemented: true, description: "Read-only CEO daily brief." },
  { name: "get_revenue_summary", risk: "green", readonly: true, implemented: true, description: "Reconciled revenue totals." },
  { name: "get_outstanding_installments", risk: "green", readonly: true, implemented: true, description: "Overdue/outstanding installments." },
  { name: "get_payment_proof_queue", risk: "green", readonly: true, implemented: true, description: "Open proof queue depth." },
  { name: "get_abandoned_checkouts", risk: "green", readonly: true, implemented: true, description: "Abandoned checkout value." },
  { name: "get_paid_without_access", risk: "green", readonly: true, implemented: true, description: "Paid-without-enrollment anomalies." },
  { name: "get_active_offers", risk: "green", readonly: true, implemented: true, description: "Live published offers." },
  { name: "get_hot_leads", risk: "green", readonly: true, implemented: true, description: "Prioritized leads." },
  { name: "get_campaign_performance", risk: "green", readonly: true, implemented: true, description: "SMS campaign stats." },
  { name: "prepare_sms_campaign", risk: "amber", readonly: false, implemented: false, description: "Draft an SMS campaign.", flag: "AIVA_CAMPAIGNS_ENABLED" },
  { name: "preview_sms_campaign", risk: "green", readonly: true, implemented: false, description: "Preview recipients (dry run).", flag: "AIVA_CAMPAIGNS_ENABLED" },
  { name: "approve_sms_campaign", risk: "amber", readonly: false, implemented: false, description: "Approve + queue a campaign.", flag: "AIVA_CAMPAIGNS_ENABLED" },
  { name: "create_staff_call_tasks", risk: "amber", readonly: false, implemented: false, description: "Create counselor call tasks." },
  { name: "duplicate_course_as_draft", risk: "amber", readonly: false, implemented: false, description: "Clone a course into a draft." },
  { name: "duplicate_webinar_as_draft", risk: "amber", readonly: false, implemented: false, description: "Clone a webinar into a draft." },
  { name: "prepare_batch_launch", risk: "amber", readonly: false, implemented: false, description: "Prepare a batch launch checklist." },
  { name: "create_payment_retry_link", risk: "amber", readonly: false, implemented: false, description: "Create a retry link.", flag: "AIVA_INSTALLMENT_REMINDERS_ENABLED" },
  { name: "record_agent_feedback", risk: "green", readonly: false, implemented: false, description: "Record decision feedback.", flag: "AIVA_LEARNING_ENABLED" },
];

export function getTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

export type ToolResult =
  | { ok: true; disabled?: false; data: unknown }
  | { ok: false; disabled: true; reason: string };

/**
 * Server-side execution gate. In the first release this NEVER mutates business data — any
 * amber/red or not-yet-implemented tool returns a DISABLED result and records an audit entry.
 */
export async function executeTool(name: string, session: AivaSession): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) {
    await writeAudit({ actor_id: session.admin_id, actor_username: session.username, action: `tool:${name}`, outcome: "blocked", reason: "unknown_tool" });
    return { ok: false, disabled: true, reason: "Unknown tool." };
  }

  const gate = canExecute(tool.risk);
  const blocked = !gate.allowed || !tool.implemented || !tool.readonly;

  await writeAudit({
    actor_id: session.admin_id,
    actor_username: session.username,
    action: `tool:${name}`,
    risk: tool.risk,
    outcome: blocked ? "blocked" : "read",
    reason: blocked ? gate.reason || "not_implemented_or_mutating" : undefined,
  });

  if (blocked) {
    return {
      ok: false,
      disabled: true,
      reason: gate.reason || "This tool is disabled in the read-only first release.",
    };
  }
  // Read-only tools are surfaced through dedicated API routes; the registry gate is the guard.
  return { ok: true, data: { tool: tool.name, note: "Use the dedicated read API for data." } };
}
