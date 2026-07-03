import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin, currentAdminId } from "@/lib/adminGuard";
import { resolveAudience, type AudienceSpec } from "@/lib/sms/audiences";
import { sendBatch, toGatewayScheduleTime } from "@/lib/sms/service";
import { getTemplate } from "@/lib/sms/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manual / bulk send. Staff (send_sms) may send single or segment messages with
 * an Approved/Active template; the guarded "all" audience and bulk campaigns
 * require Super Admin. sendSms enforces caps, dedupe, kill-switch and template
 * gating, so this route just fans out and tallies the outcome.
 */
export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const spec = body.audience as AudienceSpec;
  const templateId = body.templateId as string;
  const allowRecentOverride = !!body.allowRecentOverride;
  if (!spec?.type || !templateId) return NextResponse.json({ ok: false, error: "Missing template or audience" }, { status: 400 });

  // No promo route: promotional templates (T12/T13) are warm-audience only and
  // can never be sent to the guarded "all" audience.
  const tpl = await getTemplate(templateId);
  if (tpl?.message_type === "promotional" && spec.type === "all") {
    return NextResponse.json({ ok: false, error: "Promotional templates can't be sent to the All audience without a promo route. Pick a warm segment (leads / users / webinar)." }, { status: 400 });
  }

  const recipients = await resolveAudience(spec);
  const isBulk = recipients.length > 1;
  // Guard heavy/cold campaigns behind Super Admin.
  if ((spec.type === "all" || isBulk) && !(await requireSuperAdmin())) {
    return NextResponse.json({ ok: false, error: "Bulk / all-audience sends require Super Admin." }, { status: 403 });
  }

  const userId = await currentAdminId();
  // Optional deferred send (IST). Invalid/past → null → immediate send.
  const scheduleTime = toGatewayScheduleTime(body.scheduleAt as string | undefined);

  // sendBatch auto-routes to the correct endpoint (single / PUSH-BULK for
  // identical bodies / per-recipient fan-out for personalized) and enforces every
  // safeguard + the pre-batch balance guard before sending.
  const res = await sendBatch({
    recipients: recipients.map((r) => ({ mobile: r.mobile, variables: r.vars, relatedEntity: r.entity })),
    templateId,
    sentBy: { userId, type: "ADMIN" },
    audienceType: spec.type,
    allowRecentOverride,
    scheduleTime,
  });
  return NextResponse.json({
    ok: true,
    requested: res.requested, sent: res.sent, failed: res.failed, skipped: res.skipped,
    mode: res.mode, batches: res.batches, balance: res.balance,
    scheduledFor: scheduleTime,
  });
}
