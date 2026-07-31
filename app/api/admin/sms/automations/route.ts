import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin, currentAdminId } from "@/lib/adminGuard";
import { listRules, upsertRule, listTemplates, getAutomationActivityStats } from "@/lib/sms/store";
import { pollDeliveryStatuses } from "@/lib/sms/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  // Settle recent SENT → DELIVERED/FAILED before counting so Today pills are honest.
  try { await pollDeliveryStatuses({ sinceDays: 2, limit: 150 }); } catch { /* non-fatal */ }
  const [rules, templates] = await Promise.all([listRules(), listTemplates()]);
  const activity = await getAutomationActivityStats(rules.map((r) => r.trigger));
  const tName = new Map(templates.map((t) => [t.id, t.name]));
  const tReady = new Map(templates.map((t) => [t.id, (t.status === "active" || t.status === "approved") && !!t.gateway_template_id]));
  const empty = { last_run_at: null as string | null, sends_today: 0, delivered_today: 0, failed_today: 0, pending_today: 0 };
  const enriched = rules.map((r) => {
    const stats = activity[r.trigger] || empty;
    return {
      ...r,
      last_run_at: stats.last_run_at || r.last_run_at,
      sends_today: stats.sends_today,
      delivered_today: stats.delivered_today,
      failed_today: stats.failed_today,
      pending_today: stats.pending_today,
      template_name: r.template_id ? tName.get(r.template_id) || r.template_id : null,
      template_ready: r.template_id ? !!tReady.get(r.template_id) : false,
    };
  });
  enriched.sort((a, b) => {
    if (b.sends_today !== a.sends_today) return b.sends_today - a.sends_today;
    const aRun = a.last_run_at || "";
    const bRun = b.last_run_at || "";
    if (aRun !== bRun) return bRun.localeCompare(aRun);
    return a.trigger.localeCompare(b.trigger);
  });
  return NextResponse.json({ ok: true, rules: enriched });
}

export async function PATCH(req: Request) {
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Super Admin only" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const trigger = body.trigger as string;
  if (!trigger) return NextResponse.json({ ok: false, error: "Missing trigger" }, { status: 400 });
  const patch: Record<string, unknown> = { updated_by: await currentAdminId() };
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  if (body.delay_minutes !== undefined) patch.delay_minutes = body.delay_minutes === null ? null : Number(body.delay_minutes);
  if (body.schedule_time !== undefined) patch.schedule_time = body.schedule_time || null;
  if (body.offset_minutes !== undefined) patch.offset_minutes = body.offset_minutes === null ? null : Number(body.offset_minutes);
  if (body.template_id !== undefined) patch.template_id = body.template_id || null;
  if (body.audience_type !== undefined) patch.audience_type = body.audience_type || null;
  const rule = await upsertRule(trigger, patch);
  return NextResponse.json({ ok: true, rule });
}
