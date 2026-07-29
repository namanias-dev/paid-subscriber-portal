import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { resolveAudience, type AudienceSpec } from "@/lib/sms/audiences";
import { mergeSendVars, RECIPIENT_ONLY_VARS } from "@/lib/sms/service";
import { prepareAndRenderSms } from "@/lib/sms/renderPipeline";
import { getTemplate, getSettings } from "@/lib/sms/store";
import { getResolvedDefaults } from "@/lib/sms/variables";
import { WORST_SAMPLE } from "@/lib/sms/templates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type VarSource = "real" | "store" | "sample" | "missing";

/**
 * Rich per-recipient template preview for the Send tab.
 * Uses the SAME {@link prepareAndRenderSms} pipeline as sendSms / sendBatch so
 * preview text === send text (including sms_short_title → auto-shorten → clamp).
 */
export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const spec = body.audience as AudienceSpec;
  const templateId = body.templateId as string;
  const index = Math.max(0, Number(body.index) || 0);
  if (!spec?.type || !templateId) return NextResponse.json({ ok: false, error: "Missing template or audience" }, { status: 400 });

  const tpl = await getTemplate(templateId);
  if (!tpl) return NextResponse.json({ ok: false, error: "Template not found" }, { status: 404 });

  const [recipients, storeDefaults, settings] = await Promise.all([resolveAudience(spec), getResolvedDefaults(templateId), getSettings()]);
  const total = recipients.length;
  const costPerSms = settings.costPerSms ?? 0.13;

  const dlt = {
    id: tpl.gateway_template_id,
    status: tpl.status,
    approved: (tpl.status === "approved" || tpl.status === "active") && !!tpl.gateway_template_id,
    messageType: tpl.message_type,
  };

  let deliverable = 0;
  let totalSegments = 0;
  const reasons: Record<string, number> = {};
  const preflightViolations: { mobile: string; reason: string; detail: string }[] = [];
  for (const r of recipients) {
    const merged = mergeSendVars(templateId, storeDefaults, r.vars);
    const rendered = prepareAndRenderSms(tpl.body_template, templateId, merged);
    if (!rendered.ok) {
      const reason = rendered.dltViolations.length
        ? "dlt_var_too_long"
        : rendered.missing.length
          ? "missing_vars"
          : rendered.blocked || "invalid_body";
      reasons[reason] = (reasons[reason] || 0) + 1;
      if (preflightViolations.length < 25) {
        preflightViolations.push({
          mobile: r.normalized,
          reason,
          detail: rendered.errors.join("; ") || rendered.missing.join(", ") || reason,
        });
      }
      continue;
    }
    deliverable++;
    totalSegments += rendered.segments;
  }
  const cost = {
    costPerSms,
    credits: totalSegments,
    estimate: Math.round(totalSegments * costPerSms * 100) / 100,
  };

  if (total === 0) {
    return NextResponse.json({
      ok: true, total: 0, index: 0, dlt, recipient: null, vars: [], text: "", chars: 0, segments: 0,
      gsm: true, encoding: "GSM-7", deliverable: 0, cost,
      coverage: { total: 0, deliverable: 0, skipped: 0, reasons },
      preflightOk: true, preflightViolations: [],
    });
  }

  const idx = Math.min(index, total - 1);
  const r = recipients[idx];
  const realVars = withDerivedVarsNoStore(r.vars);
  const realMerged = mergeSendVars(templateId, storeDefaults, r.vars);
  const realRendered = prepareAndRenderSms(tpl.body_template, templateId, realMerged);

  const slots = tpl.variables;
  const vars = slots.map((key) => {
    // Show the value AFTER the shared pipeline (shortened item_short, etc.).
    const resolved = nonEmpty(realRendered.vars[key]);
    const real = nonEmpty(realVars[key]);
    const store = nonEmpty(storeDefaults[key]);
    const sample = WORST_SAMPLE[key];
    const recipientOnly = RECIPIENT_ONLY_VARS.has(key);
    let source: VarSource; let value: string;
    if (resolved != null) {
      value = resolved;
      if (!recipientOnly && store != null && store === resolved) source = "store";
      else if (real != null) source = "real";
      else if (store != null) source = "store";
      else source = "real";
    } else if (!recipientOnly && store != null) { source = "store"; value = store; }
    else if (real != null) { source = "real"; value = real; }
    else if (sample != null) { source = "sample"; value = sample; }
    else { source = "missing"; value = ""; }
    return { key, value, source, length: [...value].length };
  });

  // Readable preview: same pipeline, sample fill only for empty slots (display).
  const readableVars: Record<string, string | number | null | undefined> = { ...realMerged };
  for (const key of slots) {
    if (nonEmpty(readableVars[key]) == null && WORST_SAMPLE[key] != null) readableVars[key] = WORST_SAMPLE[key];
  }
  const rendered = prepareAndRenderSms(tpl.body_template, templateId, readableVars);

  return NextResponse.json({
    ok: true,
    total,
    index: idx,
    dlt,
    recipient: { mobile: r.normalized, name: r.name },
    vars,
    text: rendered.text,
    chars: rendered.length,
    segments: rendered.segments,
    gsm: rendered.gsm,
    encoding: rendered.gsm ? "GSM-7" : "UCS-2",
    deliverable: realRendered.ok,
    missingForRecipient: realRendered.missing,
    blocked: realRendered.blocked,
    errors: realRendered.errors,
    warnings: realRendered.warnings,
    cost,
    coverage: { total, deliverable, skipped: total - deliverable, reasons },
    preflightOk: preflightViolations.length === 0 && deliverable === total,
    preflightViolations,
  });
}

function nonEmpty(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function stripEmpty(vars: Record<string, string | number | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) { const s = nonEmpty(v); if (s != null) out[k] = s; }
  return out;
}
function withDerivedVarsNoStore(vars: Record<string, string | number | null | undefined>): Record<string, string> {
  const out = stripEmpty(vars);
  if (!out.first_name && out.name) out.first_name = out.name.trim().split(/\s+/)[0];
  return out;
}
