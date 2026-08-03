import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requirePermission, requireSuperAdmin, currentAdminId } from "@/lib/adminGuard";
import { resolveAudience, type AudienceSpec } from "@/lib/sms/audiences";
import { sendBatch } from "@/lib/sms/service";
import { getTemplate, getSettings } from "@/lib/sms/store";
import {
  isPromoTemplate,
  isWithinPromoWindow,
  nextValidPromoSlot,
  parseIstScheduleInput,
  formatIstScheduleLabel,
  toDatetimeLocalIst,
  promoWindowStatus,
} from "@/lib/sms/promoQuietHours";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manual / bulk send. Staff (send_sms) may send single or segment messages with
 * an Approved/Active template; the guarded "all" audience and bulk campaigns
 * require Super Admin. sendSms enforces caps, dedupe, kill-switch and template
 * gating, so this route just fans out and tallies the outcome.
 *
 * Optional scheduleAt (datetime-local IST) → sms_promo_queue + sms-dispatch cron.
 * Blank = send now. Invalid/past = 400 (never silent immediate send).
 */
export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const spec = body.audience as AudienceSpec;
  const templateId = body.templateId as string;
  const allowRecentOverride = !!body.allowRecentOverride;
  if (!spec?.type || !templateId) return NextResponse.json({ ok: false, error: "Missing template or audience" }, { status: 400 });

  const tpl = await getTemplate(templateId);
  if (tpl?.message_type === "promotional" && spec.type === "all") {
    return NextResponse.json({ ok: false, error: "Promotional templates can't be sent to the All audience without a promo route. Pick a warm segment (leads / users / webinar)." }, { status: 400 });
  }

  const settings = await getSettings();
  let scheduleFor: Date | null = null;
  const rawSchedule = typeof body.scheduleAt === "string" ? body.scheduleAt.trim() : "";
  if (rawSchedule) {
    const parsed = parseIstScheduleInput(rawSchedule);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error, code: parsed.code }, { status: 400 });
    }
    // Promo scheduled outside quiet-hours window → reject with next valid slot (no silent move).
    if (tpl && isPromoTemplate(tpl) && !isWithinPromoWindow(settings, parsed.at)) {
      const next = nextValidPromoSlot(settings, parsed.at);
      return NextResponse.json({
        ok: false,
        error: `Promo templates may only be scheduled between ${settings.promoWindowStart || settings.windowStart || "10:00"}–${settings.promoWindowEnd || settings.windowEnd || "21:00"} IST. That time is outside the window.`,
        code: "promo_outside_window",
        nextValidSlot: {
          utcIso: next.toISOString(),
          istLabel: formatIstScheduleLabel(next),
          datetimeLocal: toDatetimeLocalIst(next),
        },
        promoWindow: promoWindowStatus(settings),
      }, { status: 400 });
    }
    scheduleFor = parsed.at;
  }

  const recipients = await resolveAudience(spec);
  const isBulk = recipients.length > 1;
  if ((spec.type === "all" || isBulk) && !(await requireSuperAdmin())) {
    return NextResponse.json({ ok: false, error: "Bulk / all-audience sends require Super Admin." }, { status: 403 });
  }

  const userId = await currentAdminId();
  const campaignId = (typeof body.campaignId === "string" && body.campaignId) || randomUUID();

  const res = await sendBatch({
    recipients: recipients.map((r) => ({ mobile: r.mobile, variables: r.vars, relatedEntity: r.entity })),
    templateId,
    sentBy: { userId, type: "ADMIN" },
    audienceType: spec.type,
    allowRecentOverride,
    scheduleFor,
    // Do not pass gateway scheduleTime — scheduling is owned by sms_promo_queue.
    campaignId,
    triggerEvent: scheduleFor ? "manual_schedule" : "manual_send",
  });

  const scheduledOk = (res.scheduled || 0) > 0 && scheduleFor;
  return NextResponse.json({
    ok: !res.aborted,
    campaignId: scheduledOk ? null : campaignId,
    requested: res.requested,
    sent: res.sent,
    failed: res.failed,
    scheduled: res.scheduled || 0,
    skipped: res.skipped,
    mode: res.mode,
    batches: res.batches,
    balance: res.balance,
    scheduledFor: res.scheduledFor || null,
    scheduledForIst: res.scheduledForIst || null,
    queueIds: res.queueIds || [],
    aborted: !!res.aborted,
    abortReason: res.abortReason || null,
    violations: res.violations || [],
    promoWindow: promoWindowStatus(settings),
    error: res.aborted
      ? `Batch aborted before any send: ${res.violations?.length || 0} recipient(s) failed DLT/GSM/body preflight. Fix and retry — nothing was sent.`
      : undefined,
  });
}
