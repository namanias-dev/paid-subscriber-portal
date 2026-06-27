import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin, currentAdminId } from "@/lib/adminGuard";
import { resolveAudience, type AudienceSpec } from "@/lib/sms/audiences";
import { sendSms } from "@/lib/sms/service";

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

  const recipients = await resolveAudience(spec);
  const isBulk = recipients.length > 1;
  // Guard heavy/cold campaigns behind Super Admin.
  if ((spec.type === "all" || isBulk) && !(await requireSuperAdmin())) {
    return NextResponse.json({ ok: false, error: "Bulk / all-audience sends require Super Admin." }, { status: 403 });
  }

  const userId = await currentAdminId();
  const tally = { requested: recipients.length, sent: 0, failed: 0, skipped: {} as Record<string, number> };
  for (const r of recipients) {
    const res = await sendSms({
      mobile: r.mobile, templateId, variables: r.vars, relatedEntity: r.entity,
      sentBy: { userId, type: "ADMIN" }, audienceType: spec.type, allowRecentOverride,
    });
    if (res.ok) tally.sent++;
    else if (res.skipped) tally.skipped[res.skipped] = (tally.skipped[res.skipped] || 0) + 1;
    else tally.failed++;
  }
  return NextResponse.json({ ok: true, ...tally });
}
