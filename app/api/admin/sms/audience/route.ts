import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { resolveAudience, AUDIENCE_OPTIONS, type AudienceSpec } from "@/lib/sms/audiences";
import { previewSms } from "@/lib/sms/service";
import { getSettings, countSentSince } from "@/lib/sms/store";

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

  let preview: { text: string; ok: boolean; errors: string[]; warnings: string[]; missing: string[]; length: number; segments: number } | null = null;
  if (templateId && recipients[0]) {
    preview = await previewSms(templateId, recipients[0].vars);
  }

  // cap impact (approximate, today IST)
  const since = istMidnightISO();
  const usedToday = await countSentSince(since);
  const remainingDaily = settings.dailyCap > 0 ? Math.max(0, settings.dailyCap - usedToday) : null;

  return NextResponse.json({
    ok: true,
    count: recipients.length,
    audienceLabel: opt?.label || spec.type,
    promotionalForCold: !!opt?.promotionalForCold,
    perMobileCap: settings.perMobileDailyCap || null,
    dailyCap: settings.dailyCap || null,
    remainingDaily,
    willExceedDaily: remainingDaily !== null && recipients.length > remainingDaily,
    preview,
  });
}

export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, options: AUDIENCE_OPTIONS });
}
