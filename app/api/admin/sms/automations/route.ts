import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin, currentAdminId } from "@/lib/adminGuard";
import { listRules, upsertRule, listTemplates } from "@/lib/sms/store";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const [rules, templates] = await Promise.all([listRules(), listTemplates()]);
  const tName = new Map(templates.map((t) => [t.id, t.name]));
  const tReady = new Map(templates.map((t) => [t.id, (t.status === "active" || t.status === "approved") && !!t.gateway_template_id]));
  return NextResponse.json({
    ok: true,
    rules: rules.map((r) => ({ ...r, template_name: r.template_id ? tName.get(r.template_id) || r.template_id : null, template_ready: r.template_id ? !!tReady.get(r.template_id) : false })),
  });
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
