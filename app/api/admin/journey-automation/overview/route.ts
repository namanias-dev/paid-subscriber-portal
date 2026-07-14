import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { journeyFlagSnapshot } from "@/lib/journey-automation/flags";
import { listWorkflows, getSettings } from "@/lib/journey-automation/store";

export const dynamic = "force-dynamic";

/**
 * Read-only dashboard data: workflow list, feature-flag snapshot, and the global
 * kill-switch state. Gated by `journey_view` (NOT implied by send_sms). This route
 * cannot send or schedule anything — it only reads.
 */
export async function GET() {
  if (!(await requirePermission("journey_view"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const [workflows, settings] = await Promise.all([listWorkflows(), getSettings()]);
  return NextResponse.json({
    ok: true,
    workflows,
    flags: journeyFlagSnapshot(),
    killSwitch: {
      engaged: settings.kill_switch_engaged,
      reason: settings.kill_switch_reason,
      by: settings.kill_switch_by,
      at: settings.kill_switch_at,
    },
  });
}
