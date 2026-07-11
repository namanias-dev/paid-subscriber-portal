import { NextResponse } from "next/server";
import { requirePermission, currentAdminId } from "@/lib/adminGuard";
import { createTemplate, getTemplate, upsertTemplate, dltIdInUse, isSeedTemplateId } from "@/lib/sms/store";
import { validateBody, uniqueVariables, unknownVariables } from "@/lib/sms/templates";
import type { SmsMessageType, SmsUseCase } from "@/lib/sms/types";

export const dynamic = "force-dynamic";

/**
 * SELF-SERVE template management for authorized SMS staff.
 *
 * Gated by the SAME SMS RBAC key as the rest of Mission Control (`send_sms`),
 * enforced HERE in the handler (not just the page). Lets staff add / edit /
 * deactivate DLT-approved templates with NO code change. Additive — it never
 * touches the send pipeline, opt-out/consent/DND logic, or template-selection
 * semantics for existing sends.
 *
 * COMPLIANCE: this is a DLT-regulated (DND) system. Only templates whose EXACT
 * approved body is registered against a real DLT template id may be added — no
 * free-text / unapproved content. Built-in (code seed) templates are read-only
 * here; they stay under the Super-Admin editor. Deletion is intentionally not
 * offered — deactivate instead, so historical sms_logs references stay intact.
 */

const USE_CASES: SmsUseCase[] = ["PAYMENT", "WEBINAR", "POST_WEBINAR", "ONBOARDING"];
const MESSAGE_TYPES: SmsMessageType[] = ["service", "promotional"];

function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Shared field validation for create + edit. Returns an error string or null. */
async function validateFields(opts: {
  name?: string; use_case?: string; message_type?: string;
  body_template?: string; gateway_template_id?: string; exceptId?: string;
  requireAll: boolean;
}): Promise<string | null> {
  const { requireAll } = opts;
  if (requireAll || opts.name !== undefined) {
    if (!opts.name || !opts.name.trim()) return "Template name is required.";
    if (opts.name.trim().length > 120) return "Template name is too long (max 120).";
  }
  if (requireAll || opts.use_case !== undefined) {
    if (!opts.use_case || !USE_CASES.includes(opts.use_case as SmsUseCase)) return "Category (use case) must be one of PAYMENT, WEBINAR, POST_WEBINAR, ONBOARDING.";
  }
  if (requireAll || opts.message_type !== undefined) {
    if (!opts.message_type || !MESSAGE_TYPES.includes(opts.message_type as SmsMessageType)) return "Message type must be 'service' or 'promotional'.";
  }
  if (requireAll || opts.body_template !== undefined) {
    if (!opts.body_template || !opts.body_template.trim()) return "Message body is required.";
    const v = validateBody(opts.body_template);
    if (!v.ok) return v.errors.join("; ");
  }
  if (requireAll || opts.gateway_template_id !== undefined) {
    const dlt = (opts.gateway_template_id || "").trim();
    if (!dlt) return "A DLT Template ID is required (only DLT-approved templates may be added).";
    if (!/^\d{6,25}$/.test(dlt)) return "DLT Template ID must be numeric (6–25 digits).";
    if (await dltIdInUse(dlt, opts.exceptId)) return "That DLT Template ID is already used by another template.";
  }
  return null;
}

/** Build the non-blocking warnings for a body (unknown placeholders + length). */
function bodyWarnings(body: string): string[] {
  const out: string[] = [];
  const unknown = unknownVariables(body);
  if (unknown.length) out.push(`Unknown placeholder(s) ${unknown.map((u) => `{${u}}`).join(", ")} — nothing fills these, so they render empty and recipients are skipped as missing-vars at send time.`);
  const v = validateBody(body);
  out.push(...v.warnings);
  return out;
}

/** CREATE a new self-serve template. */
export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const name = s(body.name).trim();
  const use_case = s(body.use_case) || "WEBINAR";
  const message_type = s(body.message_type) || "service";
  const body_template = s(body.body_template);
  const gateway_template_id = s(body.gateway_template_id).trim();
  const sender_id = s(body.sender_id).trim() || null;
  const route = s(body.route).trim() || null;
  const audience_type = body.audience_type === null ? null : (s(body.audience_type).trim() || null);
  const is_active = body.is_active === undefined ? true : !!body.is_active;

  const err = await validateFields({ name, use_case, message_type, body_template, gateway_template_id, requireAll: true });
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });

  const created = await createTemplate({
    name, use_case: use_case as SmsUseCase, message_type: message_type as SmsMessageType,
    body_template, gateway_template_id, sender_id, route, audience_type,
    is_active, created_by: await currentAdminId(),
  });
  if (!created) return NextResponse.json({ ok: false, error: "Could not create template (id/DLT clash or store error)." }, { status: 500 });

  return NextResponse.json({ ok: true, template: created, variables: uniqueVariables(body_template), warnings: bodyWarnings(body_template) });
}

/**
 * EDIT / DEACTIVATE / ACTIVATE a self-serve template.
 * action: "deactivate" | "activate" | "update" (default "update").
 * Built-in (code seed) templates are rejected — they remain under the Super
 * Admin editor so approved bodies/ids can't drift from the code source of truth.
 */
export async function PATCH(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = s(body.id).trim();
  if (!id) return NextResponse.json({ ok: false, error: "Missing template id" }, { status: 400 });

  const existing = await getTemplate(id);
  if (!existing) return NextResponse.json({ ok: false, error: "Template not found" }, { status: 404 });
  if (isSeedTemplateId(id)) return NextResponse.json({ ok: false, error: "Built-in templates are managed by a Super Admin in the Templates editor and can't be changed here." }, { status: 403 });

  const action = s(body.action) || "update";
  const updatedBy = await currentAdminId();

  if (action === "deactivate") {
    const saved = await upsertTemplate(id, { status: "inactive", is_active: false, updated_by: updatedBy });
    if (!saved) return NextResponse.json({ ok: false, error: "Deactivate failed" }, { status: 500 });
    return NextResponse.json({ ok: true, template: saved });
  }

  if (action === "activate") {
    const effBody = existing.body_template;
    const effDlt = existing.gateway_template_id;
    if (!effDlt) return NextResponse.json({ ok: false, error: "A DLT Template ID is required before activation." }, { status: 400 });
    const v = validateBody(effBody);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.errors.join("; ") }, { status: 400 });
    const saved = await upsertTemplate(id, { status: "active", is_active: true, updated_by: updatedBy });
    if (!saved) return NextResponse.json({ ok: false, error: "Activate failed" }, { status: 500 });
    return NextResponse.json({ ok: true, template: saved });
  }

  // ---- update fields ----
  const patch: Record<string, unknown> = { updated_by: updatedBy };
  const nextBody = body.body_template !== undefined ? s(body.body_template) : undefined;
  const nextDlt = body.gateway_template_id !== undefined ? s(body.gateway_template_id).trim() : undefined;

  const err = await validateFields({
    name: body.name !== undefined ? s(body.name) : undefined,
    use_case: body.use_case !== undefined ? s(body.use_case) : undefined,
    message_type: body.message_type !== undefined ? s(body.message_type) : undefined,
    body_template: nextBody,
    gateway_template_id: nextDlt,
    exceptId: id,
    requireAll: false,
  });
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });

  if (body.name !== undefined) patch.name = s(body.name).trim();
  if (body.use_case !== undefined) patch.use_case = s(body.use_case);
  if (body.message_type !== undefined) patch.message_type = s(body.message_type);
  if (body.audience_type !== undefined) patch.audience_type = body.audience_type === null ? null : (s(body.audience_type).trim() || null);
  if (body.sender_id !== undefined) patch.sender_id = s(body.sender_id).trim() || "NAMIAS";
  if (body.route !== undefined) patch.route = s(body.route).trim() || "12";
  if (nextBody !== undefined) patch.body_template = nextBody;
  if (nextDlt !== undefined) patch.gateway_template_id = nextDlt || null;
  if (body.is_active !== undefined) {
    patch.is_active = !!body.is_active;
    patch.status = body.is_active ? "active" : "inactive";
  }

  const saved = await upsertTemplate(id, patch);
  if (!saved) return NextResponse.json({ ok: false, error: "Save failed" }, { status: 500 });
  return NextResponse.json({ ok: true, template: saved, variables: saved.variables, warnings: bodyWarnings(saved.body_template) });
}
