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

  let preview: { text: string; ok: boolean; errors: string[]; warnings: string[]; missing: string[]; length: number; segments: number } | null = null;
  if (templateId && recipients[0]) {
    preview = await previewSms(templateId, recipients[0].vars);
  }

  // cap impact (approximate, today IST)
  const since = istMidnightISO();
  const usedToday = await countSentSince(since);
  const remainingDaily = settings.dailyCap > 0 ? Math.max(0, settings.dailyCap - usedToday) : null;

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
  });
}

export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, options: AUDIENCE_OPTIONS });
}
