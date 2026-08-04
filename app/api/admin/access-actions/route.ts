import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { requireAnyPermission, currentAdminId } from "@/lib/adminGuard";
import {
  extendCourseAccess,
  revokeCourseExtension,
  remindCourseAccess,
  createCollectionsCallTask,
  ACCESS_GRANT_MAX_DAYS_DEFAULT,
} from "@/lib/accessActions";
import { listMissingInstructionsFollowUps } from "@/lib/studentAccessEvents";
import { getCourseEnrollmentById } from "@/lib/dataProvider";
import { hasPermission, isSuperAdmin } from "@/lib/permissions";
import { effectivePermissions } from "@/lib/adminGuard";

const FINANCE_PERMS = ["view_revenue", "manage_payments"] as const;

export const dynamic = "force-dynamic";

/**
 * Unified access action API — remind / extend / revoke_extension / create_call_task /
 * list_missing_followups. Same handlers as Access at Risk + student profile.
 */
export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session || !(await requireAnyPermission([...FINANCE_PERMS]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const actor = {
    id: (await currentAdminId()) || null,
    name: session.username || "admin",
  };

  if (action === "list_missing_followups") {
    const since = String(body.since || new Date(Date.now() - 7 * 86400000).toISOString());
    const missing = await listMissingInstructionsFollowUps(since);
    return NextResponse.json({ ok: true, missing });
  }

  if (action === "remind") {
    const enrollmentId = String(body.enrollment_id || "");
    if (!enrollmentId) return NextResponse.json({ ok: false, error: "enrollment_id required" }, { status: 400 });
    const r = await remindCourseAccess({
      enrollmentId,
      actor,
      allowRecentOverride: !!body.allow_recent_override,
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, reason: r.reason }, { status: 400 });
    return NextResponse.json({ ok: true, logId: r.logId, followUpScheduled: r.followUpScheduled });
  }

  if (action === "extend") {
    const phone = String(body.phone || "").trim();
    const courseId = String(body.course_id || "");
    const reason = String(body.reason || body.note || "");
    if (!phone || !courseId) return NextResponse.json({ ok: false, error: "phone and course_id required" }, { status: 400 });
    if (!reason.trim()) return NextResponse.json({ ok: false, error: "reason required" }, { status: 400 });
    const days = Math.min(
      Math.max(1, Number(body.days) || ACCESS_GRANT_MAX_DAYS_DEFAULT),
      90,
    );
    const expiresAt = body.expires_at
      ? String(body.expires_at)
      : new Date(Date.now() + days * 86400000).toISOString();
    const perms = effectivePermissions(session);
    const elevated = hasPermission(perms, "manage_staff") || isSuperAdmin(perms);
    const r = await extendCourseAccess({
      phone,
      courseId,
      expiresAt,
      reason,
      actor,
      elevated,
      enrollmentId: body.enrollment_id ? String(body.enrollment_id) : null,
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code }, { status: 400 });
    return NextResponse.json({ ok: true, days: r.days });
  }

  if (action === "revoke_extension") {
    const phone = String(body.phone || "").trim();
    const courseId = String(body.course_id || "");
    if (!phone || !courseId) return NextResponse.json({ ok: false, error: "phone and course_id required" }, { status: 400 });
    const r = await revokeCourseExtension({
      phone,
      courseId,
      actor,
      reason: body.reason ? String(body.reason) : "Revoked by staff",
      enrollmentId: body.enrollment_id ? String(body.enrollment_id) : null,
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "create_call_task") {
    const enrollmentId = String(body.enrollment_id || "");
    if (!enrollmentId) return NextResponse.json({ ok: false, error: "enrollment_id required" }, { status: 400 });
    const e = await getCourseEnrollmentById(enrollmentId);
    if (!e) return NextResponse.json({ ok: false, error: "Enrollment not found" }, { status: 404 });
    const r = await createCollectionsCallTask({
      enrollmentId,
      actor,
      reason: body.reason ? String(body.reason) : "manual_call_task",
      installmentNo: body.installment_no != null ? Number(body.installment_no) : null,
      amountDue: body.amount_due != null ? Number(body.amount_due) : null,
      daysOverdue: body.days_overdue != null ? Number(body.days_overdue) : null,
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
