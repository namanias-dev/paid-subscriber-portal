import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { resolveAudience, type AudienceSpec } from "@/lib/sms/audiences";
import { mergeSendVars, withDerivedVars } from "@/lib/sms/service";
import { getTemplate, getSettings } from "@/lib/sms/store";
import { getResolvedDefaults } from "@/lib/sms/variables";
import { renderTemplate, validateBody, WORST_SAMPLE } from "@/lib/sms/templates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type VarSource = "real" | "store" | "sample" | "missing";

/**
 * Rich per-recipient template preview for the Send tab. For the recipient at
 * `index` it returns the exact message they'd get, a per-variable breakdown of
 * where each value came from (REAL recipient data > variable store/global >
 * sample-for-preview > missing), plus audience-wide COVERAGE: how many recipients
 * would actually send vs be skipped (missing required data / invalid body) — the
 * same screening sendBatch applies, so the number is truthful. Sample values are
 * ONLY used to make the preview readable; they never make a recipient deliverable.
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

  // Audience-wide coverage + cost: render each recipient with REAL + store (no
  // sample), count who would actually send and sum their segments (=credits).
  // CPU-only — store defaults fetched once.
  let deliverable = 0;
  let totalSegments = 0;
  const reasons: Record<string, number> = {};
  for (const r of recipients) {
    const merged = mergeSendVars(templateId, storeDefaults, r.vars);
    const rendered = renderTemplate(tpl.body_template, merged);
    if (rendered.missing.length) { reasons.missing_vars = (reasons.missing_vars || 0) + 1; continue; }
    const v = validateBody(rendered.text);
    if (!v.ok) { reasons.invalid_body = (reasons.invalid_body || 0) + 1; continue; }
    deliverable++;
    totalSegments += v.analysis.segments;
  }
  const cost = {
    costPerSms,
    credits: totalSegments,
    estimate: Math.round(totalSegments * costPerSms * 100) / 100,
  };

  if (total === 0) {
    return NextResponse.json({ ok: true, total: 0, index: 0, dlt, recipient: null, vars: [], text: "", chars: 0, segments: 0, deliverable: 0, cost, coverage: { total: 0, deliverable: 0, skipped: 0, reasons } });
  }

  const idx = Math.min(index, total - 1);
  const r = recipients[idx];

  // Real values available for THIS recipient (derive first_name from a real name).
  const realVars = withDerivedVarsNoStore(r.vars);

  const slots = tpl.variables;
  const vars = slots.map((key) => {
    const real = nonEmpty(realVars[key]);
    const store = nonEmpty(storeDefaults[key]);
    const sample = WORST_SAMPLE[key];
    let source: VarSource; let value: string;
    if (real != null) { source = "real"; value = real; }
    else if (store != null) { source = "store"; value = store; }
    else if (sample != null) { source = "sample"; value = sample; }
    else { source = "missing"; value = ""; }
    return { key, value, source };
  });

  // Readable preview: real > store > sample fills every slot so admins see the
  // final shape; the per-var chips flag which slots fell back to sample/missing.
  const readableVars = withDerivedVars(templateId, { ...WORST_SAMPLE, ...storeDefaults, ...stripEmpty(r.vars) });
  const rendered = renderTemplate(tpl.body_template, readableVars);
  const analysis = validateBody(rendered.text).analysis;

  // Is THIS recipient deliverable for real (no sample needed)?
  const realMerged = mergeSendVars(templateId, storeDefaults, r.vars);
  const realMissing = renderTemplate(tpl.body_template, realMerged).missing;

  return NextResponse.json({
    ok: true,
    total,
    index: idx,
    dlt,
    recipient: { mobile: r.normalized, name: r.name },
    vars,
    text: rendered.text,
    chars: analysis.length,
    segments: analysis.segments,
    gsm: analysis.gsm,
    deliverable: realMissing.length === 0,
    missingForRecipient: realMissing,
    cost,
    coverage: { total, deliverable, skipped: total - deliverable, reasons },
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
/** first_name derived from a real name only — NO store/config injection (that's tracked separately). */
function withDerivedVarsNoStore(vars: Record<string, string | number | null | undefined>): Record<string, string> {
  const out = stripEmpty(vars);
  if (!out.first_name && out.name) out.first_name = out.name.trim().split(/\s+/)[0];
  return out;
}
