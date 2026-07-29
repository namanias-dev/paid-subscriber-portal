import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { resolveAudience, AUDIENCE_OPTIONS, type AudienceSpec } from "@/lib/sms/audiences";
import { previewSms } from "@/lib/sms/service";
import { getSettings, countSentSince, getTemplate } from "@/lib/sms/store";

export const dynamic = "force-dynamic";

function istMidnightISO(): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${ymd}T00:00:00+05:30`).toISOString();
}

/** Preview a send: recipient count, dedupe note, cap impact, filled sample. */
export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const spec = body.audience as AudienceSpec;
  const templateId = body.templateId as string;
  if (!spec?.type) return NextResponse.json({ ok: false, error: "Missing audience" }, { status: 400 });

  const recipients = await resolveAudience(spec);
  const settings = await getSettings();
  const opt = AUDIENCE_OPTIONS.find((o) => o.type === spec.type);
  const tpl = templateId ? await getTemplate(templateId) : null;
  const promotional = tpl?.message_type === "promotional";
  const blocked = promotional && spec.type === "all";

  let preview: {
    text: string; ok: boolean; errors: string[]; warnings: string[]; missing: string[];
    length: number; segments: number; gsm?: boolean; encoding?: string;
    item_short?: string; item_short_len?: number;
  } | null = null;
  let preflightOk = true;
  let preflightViolations: { mobile: string; reason: string; detail: string }[] = [];
  let totalSegments = 0;
  if (templateId && recipients.length) {
    const { prepareAndRenderSms } = await import("@/lib/sms/renderPipeline");
    const { mergeSendVars } = await import("@/lib/sms/service");
    const { getResolvedDefaults } = await import("@/lib/sms/variables");
    const defaults = await getResolvedDefaults(templateId);
    const tplBody = tpl?.body_template || "";
    for (const r of recipients) {
      const merged = mergeSendVars(templateId, defaults, r.vars);
      const rendered = prepareAndRenderSms(tplBody, templateId, merged);
      if (!rendered.ok) {
        preflightOk = false;
        if (preflightViolations.length < 30) {
          preflightViolations.push({
            mobile: r.normalized,
            reason: rendered.blocked || (rendered.missing.length ? "missing_vars" : "invalid_body"),
            detail: rendered.errors.join("; ") || rendered.missing.join(", ") || "blocked",
          });
        }
      } else {
        totalSegments += rendered.segments;
      }
    }
    if (recipients[0]) {
      const sample = await previewSms(templateId, recipients[0].vars);
      if (sample) {
        const item = sample.vars?.item_short != null ? String(sample.vars.item_short) : undefined;
        preview = {
          text: sample.text,
          ok: sample.ok,
          errors: sample.errors,
          warnings: sample.warnings,
          missing: sample.missing,
          length: sample.length,
          segments: sample.segments,
          gsm: sample.gsm,
          encoding: sample.gsm ? "GSM-7" : "UCS-2",
          item_short: item,
          item_short_len: item ? [...item].length : undefined,
        };
      }
    }
  }

  // cap impact (approximate, today IST)
  const since = istMidnightISO();
  const usedToday = await countSentSince(since);
  const remainingDaily = settings.dailyCap > 0 ? Math.max(0, settings.dailyCap - usedToday) : null;
  const costPerSms = settings.costPerSms ?? 0.13;

  // WHO: optional recipient list (name + number) for the searchable/scrollable
  // preview. Off by default to keep count-only previews light.
  const list = body.includeList
    ? recipients.map((r) => ({ mobile: r.normalized, name: r.name }))
    : undefined;

  return NextResponse.json({
    ok: true,
    count: blocked ? 0 : recipients.length,
    audienceLabel: opt?.label || spec.type,
    promotional,
    blocked,
    blockedReason: blocked ? "Promotional templates can't target the All audience (no promo route). Choose a warm segment." : null,
    perMobileCap: settings.perMobileDailyCap || null,
    dailyCap: settings.dailyCap || null,
    remainingDaily,
    willExceedDaily: remainingDaily !== null && recipients.length > remainingDaily,
    preview,
    recipients: blocked ? [] : list,
    preflightOk: blocked ? false : preflightOk,
    preflightViolations,
    preflight: {
      recipientCount: blocked ? 0 : recipients.length,
      sampleBody: preview?.text || null,
      chars: preview?.length ?? null,
      segments: preview?.segments ?? null,
      encoding: preview?.encoding || null,
      item_short: preview?.item_short || null,
      item_short_len: preview?.item_short_len ?? null,
      estimatedCredits: totalSegments,
      estimatedCost: Math.round(totalSegments * costPerSms * 100) / 100,
      costPerSms,
    },
  });
}

export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, options: AUDIENCE_OPTIONS });
}
