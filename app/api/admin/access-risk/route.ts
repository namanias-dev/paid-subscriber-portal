import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { getAllCourseEnrollments, getAllCourses, getAllAccessOverrides } from "@/lib/dataProvider";
import { lectureAccessForCourse } from "@/lib/entitlements";
import { resolveInstallmentForEnrollment } from "@/lib/sms/installmentReminder";
import { listCapsForEnrollments } from "@/lib/sms/accessCapStore";
import { listLogs } from "@/lib/sms/store";
import {
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
} from "@/lib/sms/accessReminderConstants";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * Proactive money-recovery view: enrolled learners whose lecture access is
 * BLOCKED (past due+15d / expired / revoked) or AT RISK (in grace, or expiring
 * within 7 days). Reuses the SAME lectureAccessForCourse engine as playback.
 */
export async function GET() {
  if (!(await requireAnyPermission(["view_revenue", "manage_payments"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [enrollments, courses, overrides] = await Promise.all([
    getAllCourseEnrollments(),
    getAllCourses(),
    getAllAccessOverrides(),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const now = Date.now();

  const riskEnrollments = enrollments.filter((e) => {
    if (e.status === "cancelled") return false;
    const override = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    const access = lectureAccessForCourse(byId.get(e.course_id), e, override, false, now);
    return !access.allowed || access.status === "grace" || access.status === "expiring";
  });

  const caps = await listCapsForEnrollments(riskEnrollments.map((e) => e.id));
  const capByEnrollment = new Map<string, typeof caps[number]>();
  for (const c of caps) {
    // Prefer the cap matching the oldest unpaid installment when several exist.
    const prev = capByEnrollment.get(c.course_enrollment_id);
    if (!prev || c.needs_call || c.auto_sequences_used > (prev.auto_sequences_used || 0)) {
      capByEnrollment.set(c.course_enrollment_id, c);
    }
  }

  const since = new Date(now - 90 * DAY).toISOString();
  const [blockedLogs, expiringLogs] = await Promise.all([
    listLogs({ from: since, templateId: ACCESS_BLOCKED_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_EXPIRING_TEMPLATE_ID, limit: 5000 }),
  ]);
  const lastByEnrollment = new Map<string, string>();
  for (const l of [...blockedLogs, ...expiringLogs]) {
    if (!l.course_enrollment_id) continue;
    if (!["SENT", "DELIVERED", "QUEUED"].includes(l.status)) continue;
    const at = l.sent_at || l.created_at;
    const prev = lastByEnrollment.get(l.course_enrollment_id);
    if (!prev || prev < at) lastByEnrollment.set(l.course_enrollment_id, at);
  }

  const rows = riskEnrollments
    .map((e) => {
      const override = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
      const access = lectureAccessForCourse(byId.get(e.course_id), e, override, false, now);
      const dueMs = access.graceEndsAt ? (Date.parse(access.graceEndsAt) - 15 * DAY) : 0;
      const daysOverdue = dueMs && now > dueMs ? Math.floor((now - dueMs) / DAY) : 0;
      const resolved = resolveInstallmentForEnrollment(e, now);
      const installmentNo = resolved.ok ? resolved.resolved.installmentNo : null;
      const cap = capByEnrollment.get(e.id);
      return {
        enrollmentId: e.id,
        studentId: e.student_id ?? null,
        phone: e.phone,
        student: e.student_name,
        email: e.email,
        courseId: e.course_id,
        courseTitle: e.course_title || byId.get(e.course_id)?.title || "Course",
        batchLabel: e.batch_label,
        planType: e.plan_type,
        enrollmentStatus: e.status,
        amountDue: access.amountDue ?? Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0)),
        daysOverdue,
        installmentNo,
        access,
        autoUsed: cap?.auto_sequences_used ?? 0,
        needsCall: !!cap?.needs_call,
        lastRemindedAt: lastByEnrollment.get(e.id) ?? cap?.last_auto_sent_at ?? null,
      };
    })
    .sort((a, b) => {
      if (a.needsCall !== b.needsCall) return a.needsCall ? -1 : 1;
      const rank = (s: string) => (s === "blocked" ? 0 : s === "grace" ? 1 : 2);
      const d = rank(a.access.status) - rank(b.access.status);
      return d !== 0 ? d : b.daysOverdue - a.daysOverdue;
    });

  return NextResponse.json({ ok: true, rows });
}
