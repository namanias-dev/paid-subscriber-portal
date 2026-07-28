import { NextResponse } from "next/server";
import { requirePermission, currentAdminId } from "@/lib/adminGuard";
import { maskMobile } from "@/lib/phone";
import { buildAccessReminder } from "@/lib/sms/accessReminderService";
import { sendAccessReminderOne } from "@/lib/sms/accessReminderSend";
import { buildFollowUpPreview, FOLLOW_UP_DELAY_MINUTES } from "@/lib/sms/installmentFollowUp";

export const dynamic = "force-dynamic";

/** Preview access reminder + follow-up. Never sends. */
export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const enrollmentId = typeof body.enrollmentId === "string" ? body.enrollmentId : null;
  if (!enrollmentId) {
    return NextResponse.json({ ok: false, error: "Provide an enrollmentId." }, { status: 400 });
  }

  const [preview, followUp] = await Promise.all([
    buildAccessReminder({ enrollmentId }),
    buildFollowUpPreview(),
  ]);
  return NextResponse.json({ ok: true, preview, followUp });
}

/** Explicit second click — re-resolves and sends. */
export async function PUT(req: Request) {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const enrollmentId = typeof body.enrollmentId === "string" ? body.enrollmentId : null;
  if (!enrollmentId) {
    return NextResponse.json({ ok: false, error: "Provide an enrollmentId." }, { status: 400 });
  }

  const result = await sendAccessReminderOne({
    enrollmentId,
    actorUserId: await currentAdminId(),
    allowRecentOverride: !!body.allowRepeat,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.detail, blockReason: result.reason, skipped: result.skipped },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    logId: result.logId,
    status: result.status,
    maskedPhone: result.preview.maskedPhone || maskMobile(""),
    installmentNo: result.preview.installmentNo,
    amountDue: result.preview.amountDue,
    templateId: result.preview.templateId,
    accessStatus: result.preview.accessStatus,
    followUpScheduled: result.followUpScheduled,
    followUpDelayMinutes: FOLLOW_UP_DELAY_MINUTES,
  });
}
