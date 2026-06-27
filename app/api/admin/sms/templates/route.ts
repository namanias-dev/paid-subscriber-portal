import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin, currentAdminId } from "@/lib/adminGuard";
import { listTemplates, getTemplate, upsertTemplate } from "@/lib/sms/store";
import { validateBody, worstCaseFill, uniqueVariables } from "@/lib/sms/templates";
import { loginUrlSample } from "@/lib/sms/config";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const templates = await listTemplates();
  const sample = loginUrlSample();
  const enriched = templates.map((t) => {
    const wc = worstCaseFill(t.body_template, sample);
    const v = validateBody(t.body_template);
    return { ...t, worstCaseChars: wc.analysis.length, worstCaseSegments: wc.analysis.segments, over155: wc.analysis.length > 155, bodyErrors: v.errors };
  });
  return NextResponse.json({ ok: true, templates: enriched });
}

/**
 * Create/edit a template (Super Admin only). Editing the body or DLT id of an
 * approved/active template auto-drops it to Draft. Activating requires a DLT id
 * and a clean (GSM/Rs/no-emoji) body.
 */
export async function POST(req: Request) {
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Super Admin only" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id: string = body.id;
  if (!id) return NextResponse.json({ ok: false, error: "Missing template id" }, { status: 400 });

  const existing = await getTemplate(id);
  const updatedBy = await currentAdminId();
  const patch: Record<string, unknown> = { updated_by: updatedBy };

  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.use_case === "string") patch.use_case = body.use_case;
  if (typeof body.message_type === "string") patch.message_type = body.message_type;
  if (typeof body.audience_type === "string" || body.audience_type === null) patch.audience_type = body.audience_type;

  let bodyChanged = false;
  if (typeof body.body_template === "string" && body.body_template !== existing?.body_template) {
    const v = validateBody(body.body_template);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.errors.join("; ") }, { status: 400 });
    patch.body_template = body.body_template;
    bodyChanged = true;
  }
  let dltChanged = false;
  if (body.gateway_template_id !== undefined && body.gateway_template_id !== existing?.gateway_template_id) {
    patch.gateway_template_id = body.gateway_template_id || null;
    dltChanged = true;
  }

  // Status transitions
  let nextStatus = body.status as string | undefined;
  if ((bodyChanged || dltChanged) && existing && (existing.status === "approved" || existing.status === "active")) {
    nextStatus = "draft"; // editing an approved/active template re-opens review
  }
  if (nextStatus) {
    const effectiveBody = (patch.body_template as string) ?? existing?.body_template ?? "";
    const effectiveDlt = (patch.gateway_template_id as string) ?? existing?.gateway_template_id ?? null;
    if (nextStatus === "active" || nextStatus === "approved") {
      if (!effectiveDlt) return NextResponse.json({ ok: false, error: "A DLT Template ID is required before Approved/Active." }, { status: 400 });
      const v = validateBody(effectiveBody);
      if (!v.ok) return NextResponse.json({ ok: false, error: v.errors.join("; ") }, { status: 400 });
      // variables must map to registered slots (we store the variable list)
      patch.variables = uniqueVariables(effectiveBody);
    }
    patch.status = nextStatus;
    patch.is_active = nextStatus === "active";
  }
  if (body.auto_send_enabled !== undefined) patch.auto_send_enabled = !!body.auto_send_enabled;

  const saved = await upsertTemplate(id, patch, !existing);
  if (!saved) return NextResponse.json({ ok: false, error: "Save failed" }, { status: 500 });
  return NextResponse.json({ ok: true, template: saved });
}
