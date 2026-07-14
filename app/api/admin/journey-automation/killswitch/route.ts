import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { getSettings, setKillSwitch } from "@/lib/journey-automation/store";

export const dynamic = "force-dynamic";

/** Current global kill-switch state (view permission). */
export async function GET() {
  if (!(await requirePermission("journey_view"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const s = await getSettings();
  return NextResponse.json({
    ok: true,
    killSwitch: { engaged: s.kill_switch_engaged, reason: s.kill_switch_reason, by: s.kill_switch_by, at: s.kill_switch_at },
  });
}

/**
 * Engage / disengage the GLOBAL kill switch. Restricted to
 * `journey_manage_killswitch` (Super Admin by default). Audit-logged. Nothing runs
 * yet this shipment, but the safety surface exists before the engine.
 */
export async function POST(req: Request) {
  if (!(await requirePermission("journey_manage_killswitch"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const engaged = body.engaged === true;
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

  const settings = await setKillSwitch(engaged, reason, {
    id: actor.id,
    name: actor.name,
    role: actor.role,
    isSuper: actor.isSuper,
  });
  return NextResponse.json({
    ok: true,
    killSwitch: { engaged: settings.kill_switch_engaged, reason: settings.kill_switch_reason, by: settings.kill_switch_by, at: settings.kill_switch_at },
  });
}
