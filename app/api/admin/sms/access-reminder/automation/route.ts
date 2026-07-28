import { NextResponse } from "next/server";
import { requirePermission, currentAdminId } from "@/lib/adminGuard";
import { planAccessAutomation } from "@/lib/sms/accessAutomation";
import {
  getAccessReminderSettings,
  listNeedsCall,
  resetCap,
  setExcluded,
  updateAccessReminderSettings,
} from "@/lib/sms/accessCapStore";

export const dynamic = "force-dynamic";

/** Settings + needs_call list + next-run preview (dry plan). */
export async function GET() {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const [settings, needsCall, plan] = await Promise.all([
    getAccessReminderSettings(),
    listNeedsCall(100),
    planAccessAutomation(),
  ]);
  return NextResponse.json({
    ok: true,
    settings,
    needsCall,
    plan: {
      wouldSend: plan.wouldSend.length,
      excluded: plan.excluded,
      seatBookingOnly: plan.seatBookingOnly,
      inQuietHours: plan.inQuietHours,
      haltedReason: plan.haltedReason,
      dryRun: plan.dryRun,
      sample: plan.wouldSend.slice(0, 20).map((c) => ({
        enrollmentId: c.enrollmentId,
        studentName: c.studentName,
        maskedPhone: c.maskedPhone,
        accessStatus: c.accessStatus,
        templateId: c.templateId,
        installmentNo: c.installmentNo,
        daysLeft: c.daysLeft,
      })),
    },
  });
}

/** Update settings, exclude, or reset cap. */
export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const actor = await currentAdminId();
  const action = typeof body.action === "string" ? body.action : "settings";

  if (action === "exclude") {
    if (typeof body.enrollmentId !== "string" || typeof body.installmentNo !== "number") {
      return NextResponse.json({ ok: false, error: "enrollmentId + installmentNo required" }, { status: 400 });
    }
    await setExcluded({
      courseEnrollmentId: body.enrollmentId,
      installmentNo: body.installmentNo,
      excluded: body.excluded !== false,
      reason: typeof body.reason === "string" ? body.reason : null,
      by: actor,
      fingerprint: typeof body.fingerprint === "string" ? body.fingerprint : null,
      studentId: typeof body.studentId === "string" ? body.studentId : null,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "reset_cap") {
    if (typeof body.enrollmentId !== "string" || typeof body.installmentNo !== "number" || typeof body.reason !== "string" || !body.reason.trim()) {
      return NextResponse.json({ ok: false, error: "enrollmentId, installmentNo, and reason required" }, { status: 400 });
    }
    await resetCap({
      courseEnrollmentId: body.enrollmentId,
      installmentNo: body.installmentNo,
      reason: body.reason.trim(),
      by: actor,
    });
    return NextResponse.json({ ok: true });
  }

  const settings = await updateAccessReminderSettings({
    killSwitch: typeof body.killSwitch === "boolean" ? body.killSwitch : undefined,
    dryRun: typeof body.dryRun === "boolean" ? body.dryRun : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    rampLimit: typeof body.rampLimit === "number" ? body.rampLimit : undefined,
    dailyCeiling: typeof body.dailyCeiling === "number" ? body.dailyCeiling : undefined,
  }, actor);

  return NextResponse.json({ ok: true, settings });
}
