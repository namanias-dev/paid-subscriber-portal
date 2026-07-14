import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { journeyFlagSnapshot } from "@/lib/journey-automation/flags";
import { listWorkflows, getSettings } from "@/lib/journey-automation/store";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Best-effort map of workflow_id -> its draft/current trigger event type. */
async function triggerEventByWorkflow(): Promise<Record<string, string>> {
  const sb = getSupabaseAdmin();
  if (!sb) return {};
  const { data } = await sb.from("automation_triggers").select("workflow_id, event_type, created_at").order("created_at", { ascending: false });
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { workflow_id: string; event_type: string }[]) {
    if (!out[r.workflow_id]) out[r.workflow_id] = r.event_type;
  }
  return out;
}

/**
 * Read-only dashboard data: workflow list, feature-flag snapshot, and the global
 * kill-switch state. Gated by `journey_view` (NOT implied by send_sms). This route
 * cannot send or schedule anything — it only reads.
 */
export async function GET() {
  if (!(await requirePermission("journey_view"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const [workflows, settings, triggers] = await Promise.all([listWorkflows(), getSettings(), triggerEventByWorkflow()]);
  return NextResponse.json({
    ok: true,
    workflows,
    triggers,
    flags: journeyFlagSnapshot(),
    killSwitch: {
      engaged: settings.kill_switch_engaged,
      reason: settings.kill_switch_reason,
      by: settings.kill_switch_by,
      at: settings.kill_switch_at,
    },
  });
}
