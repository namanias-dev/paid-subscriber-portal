import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { getAllCourseEnrollments, getAllCourses, getAllAccessOverrides } from "@/lib/dataProvider";
import { lectureAccessForCourse } from "@/lib/entitlements";
import { resolveInstallmentForEnrollment } from "@/lib/sms/installmentReminder";
import { listCapsForEnrollments } from "@/lib/sms/accessCapStore";
import { listLogs } from "@/lib/sms/store";
import { activeAccessGrant, buildBulkAccessReminders } from "@/lib/sms/accessReminderService";
import { deriveEnrollment, paymentProgressLabel } from "@/lib/installments";
import { scanPaymentFailures, applyPaymentFailureFlags } from "@/lib/sms/paymentFailureFlags";
import { ACCESS_GRANT_EXPIRING_SOON_DAYS } from "@/lib/accessOverridePolicy";
import { flagNeedsCall } from "@/lib/sms/accessCapStore";
import {
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
} from "@/lib/sms/accessReminderConstants";
import { istWholeDaysUntil } from "@/lib/sms/accessDays";
import {
  isAccessAtRiskEnrollment,
  humanRemindInaction,
  nextUnpaidDatedLine,
  classifyAccessAtRisk,
} from "@/lib/accessAtRisk";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * Access At Risk worklist. ONE shared definition with the reminder gate:
 * active paid enrollment + (schedule grace/blocked OR grant holding money owed).
 */
export async function GET() {
  if (!(await requireAnyPermission(["view_revenue", "manage_payments"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [enrollments, courses, overrides, failureScan] = await Promise.all([
    getAllCourseEnrollments(),
    getAllCourses(),
    getAllAccessOverrides(),
    scanPaymentFailures(),
  ]);
  await applyPaymentFailureFlags([
    ...failureScan.failedAttempts,
    ...failureScan.verifyingStuck.filter((h) => !failureScan.failedAttempts.some((f) => f.enrollmentId === h.enrollmentId)),
  ]).catch(() => 0);

  const byId = new Map(courses.map((c) => [c.id, c]));
  const now = Date.now();

  const riskEnrollments = enrollments.filter((e) => {
    const override = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    const schedule = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    return isAccessAtRiskEnrollment({ enrollment: e, scheduleAccess: schedule, override, now });
  });

  for (const e of riskEnrollments) {
    const override = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    const grant = activeAccessGrant(override, now);
    if (!grant?.expires_at) continue;
    const days = istWholeDaysUntil(grant.expires_at, now);
    const owed = Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0));
    if (days != null && days > 0 && days <= ACCESS_GRANT_EXPIRING_SOON_DAYS && owed > 0) {
      await flagNeedsCall({
        courseEnrollmentId: e.id,
        installmentNo: 0,
        reason: `Grant expires in ${days}d · ₹${owed} outstanding`,
        studentId: e.student_id ?? null,
      }).catch(() => undefined);
    }
  }

  const caps = await listCapsForEnrollments(riskEnrollments.map((e) => e.id));
  const capByEnrollment = new Map<string, typeof caps[number]>();
  for (const c of caps) {
    const prev = capByEnrollment.get(c.course_enrollment_id);
    if (!prev || c.needs_call || c.auto_sequences_used > (prev.auto_sequences_used || 0)) {
      capByEnrollment.set(c.course_enrollment_id, c);
    }
  }

  const since = new Date(now - 90 * DAY).toISOString();
  const [blockedLogs, expiringLogs, bulk] = await Promise.all([
    listLogs({ from: since, templateId: ACCESS_BLOCKED_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_EXPIRING_TEMPLATE_ID, limit: 5000 }),
    buildBulkAccessReminders(riskEnrollments.map((e) => e.id), { now }),
  ]);
  const previewByEnrollment = new Map(bulk.previews.map((p) => [p.enrollmentId, p]));

  const lastByEnrollment = new Map<string, string>();
  for (const l of [...blockedLogs, ...expiringLogs]) {
    if (!l.course_enrollment_id) continue;
    if (!["SENT", "DELIVERED", "QUEUED"].includes(l.status)) continue;
    const at = l.sent_at || l.created_at;
    const prev = lastByEnrollment.get(l.course_enrollment_id);
    if (!prev || prev < at) lastByEnrollment.set(l.course_enrollment_id, at);
  }

  const failureByEnrollment = new Map<string, { failed: number; verifying: number }>();
  for (const h of [...failureScan.failedAttempts, ...failureScan.verifyingStuck]) {
    const prev = failureByEnrollment.get(h.enrollmentId) || { failed: 0, verifying: 0 };
    failureByEnrollment.set(h.enrollmentId, {
      failed: Math.max(prev.failed, h.failedCount),
      verifying: Math.max(prev.verifying, h.verifyingStuck),
    });
  }

  const rows = riskEnrollments
    .map((e) => {
      const override = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
      const schedule = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
      const live = lectureAccessForCourse(byId.get(e.course_id), e, override, false, now);
      const grant = activeAccessGrant(override, now);
      const classified = classifyAccessAtRisk({ enrollment: e, scheduleAccess: schedule, override, now });
      const dueMs = schedule.graceEndsAt ? (Date.parse(schedule.graceEndsAt) - 15 * DAY) : 0;
      const daysOverdue = dueMs && now > dueMs ? Math.floor((now - dueMs) / DAY) : 0;
      const resolved = resolveInstallmentForEnrollment(e, now);
      const installmentNo = resolved.ok ? resolved.resolved.installmentNo : null;
      const cap = capByEnrollment.get(e.id);
      const d = deriveEnrollment(e, now);
      const fail = failureByEnrollment.get(e.id);
      const preview = previewByEnrollment.get(e.id);
      const nextUnpaid = nextUnpaidDatedLine(e.schedule);
      const needsCall = !!cap?.needs_call;
      const remindEnabled = !!preview?.sendable && !needsCall;
      const inactionReason = remindEnabled ? null : humanRemindInaction({
        blockReason: preview?.blockReason,
        blockDetail: preview?.blockDetail,
        needsCall,
        needsCallReason: cap?.excluded_reason ?? null,
        grantExpiresAt: grant?.expires_at ?? null,
        nextUnpaid,
        scheduleStatus: schedule.status,
      });
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
        amountDue: schedule.amountDue ?? Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0)),
        amountPaid: e.amount_paid,
        totalFee: e.total_fee,
        daysOverdue,
        installmentNo,
        progressLabel: paymentProgressLabel(d),
        access: live,
        scheduleAccess: { status: schedule.status, reason: schedule.reason, graceEndsAt: schedule.graceEndsAt, daysLeft: schedule.daysLeft },
        riskKind: classified.kind,
        grant: grant ? {
          expiresAt: grant.expires_at,
          note: grant.note,
          createdBy: grant.created_by,
          daysLeft: grant.expires_at ? istWholeDaysUntil(grant.expires_at, now) : null,
        } : null,
        autoUsed: cap?.auto_sequences_used ?? 0,
        needsCall,
        needsCallReason: cap?.excluded_reason ?? null,
        lastRemindedAt: lastByEnrollment.get(e.id) ?? cap?.last_auto_sent_at ?? null,
        paymentFailures: fail?.failed ?? 0,
        verifyingStuck: fail?.verifying ?? 0,
        remindEnabled,
        inactionReason,
        nextUnpaidLabel: nextUnpaid ? `${nextUnpaid.label}${nextUnpaid.due ? ` due ${nextUnpaid.due.slice(0, 10)}` : ""}` : null,
      };
    })
    .sort((a, b) => {
      if (a.needsCall !== b.needsCall) return a.needsCall ? -1 : 1;
      if (!!a.grant !== !!b.grant) return a.grant ? -1 : 1;
      const rank = (s: string) => (s === "blocked" ? 0 : s === "grace" ? 1 : 2);
      const d = rank(a.scheduleAccess.status) - rank(b.scheduleAccess.status);
      return d !== 0 ? d : b.daysOverdue - a.daysOverdue;
    });

  const activeGrants = rows.filter((r) => r.grant).map((r) => ({
    student: r.student,
    phone: r.phone,
    courseTitle: r.courseTitle,
    expiresAt: r.grant!.expiresAt,
    createdBy: r.grant!.createdBy,
    reason: r.grant!.note,
    amountDue: r.amountDue,
    scheduleStatus: r.scheduleAccess.status,
  }));

  return NextResponse.json({
    ok: true,
    rows,
    grants: activeGrants,
    paymentFailureTotals: failureScan.totals,
    indefiniteOverrides: overrides.filter((o) => o.mode === "grant" && !o.expires_at).length,
    listMeta: {
      total: rows.length,
      remindEnabled: rows.filter((r) => r.remindEnabled).length,
      notActionable: rows.filter((r) => !r.remindEnabled).length,
    },
  });
}
