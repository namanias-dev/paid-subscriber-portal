import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { getAllCourseEnrollments, getAllCourses, getAllAccessOverrides } from "@/lib/dataProvider";
import { lectureAccessForCourse } from "@/lib/entitlements";
import { resolveInstallmentForEnrollment } from "@/lib/sms/installmentReminder";
import { getAccessReminderSettings, listCapsForEnrollments } from "@/lib/sms/accessCapStore";
import { accessInQuietHours } from "@/lib/sms/accessBulkGuards";
import { listLogs } from "@/lib/sms/store";
import { activeAccessGrant, buildBulkAccessReminders } from "@/lib/sms/accessReminderService";
import { deriveEnrollment, paymentProgressLabel } from "@/lib/installments";
import { scanPaymentFailures, applyPaymentFailureFlags } from "@/lib/sms/paymentFailureFlags";
import { ACCESS_GRANT_EXPIRING_SOON_DAYS } from "@/lib/accessOverridePolicy";
import { flagNeedsCall } from "@/lib/sms/accessCapStore";
import {
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
  ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID,
} from "@/lib/sms/accessReminderConstants";
import { istWholeDaysUntil } from "@/lib/sms/accessDays";
import { istTodayYMD, istYMD } from "@/lib/dates";
import {
  isAccessAtRiskEnrollment,
  humanRemindInaction,
  nextUnpaidDatedLine,
  classifyAccessAtRisk,
  daysOverdueFromSchedule,
  outstandingAmount,
} from "@/lib/accessAtRisk";
import { ttlCached } from "@/lib/ttlCache";
import type { AccessRiskSummaryData } from "@/lib/accessRiskSummary";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const ACCESS_RISK_CACHE_MS = 30_000;

/**
 * Access At Risk worklist. ONE shared definition with the reminder gate:
 * active paid enrollment + (schedule grace/blocked OR grant holding money owed).
 */
export async function GET() {
  if (!(await requireAnyPermission(["view_revenue", "manage_payments"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const cached = await ttlCached("admin:access-risk:v2-live", ACCESS_RISK_CACHE_MS, () => buildAccessRiskPayload());
  return NextResponse.json({ ...cached.value, cache: cached.cache });
}

async function buildAccessRiskPayload() {
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
    const owed = outstandingAmount(e);
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
  const todayYmd = istTodayYMD();
  const todayStart = new Date(`${todayYmd}T00:00:00+05:30`).toISOString();
  const riskIds = riskEnrollments.map((e) => e.id);
  const { resolveBuyersByPhones } = await import("@/lib/sms/store");
  const { normalizeIndianMobile } = await import("@/lib/phone");
  const { getSupabaseAdmin } = await import("@/lib/supabase");
  const phones = [...new Set(riskEnrollments.map((e) => normalizeIndianMobile(e.phone).digits10).filter(Boolean))] as string[];
  const [blockedLogs, expiringLogs, installmentLogs, todayAccessLogs, bulk, buyersByPhone] = await Promise.all([
    listLogs({ from: since, templateId: ACCESS_BLOCKED_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_EXPIRING_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: todayStart, limit: 5000 }),
    buildBulkAccessReminders(riskIds, { now }),
    resolveBuyersByPhones(phones),
  ]);
  const previewByEnrollment = new Map(bulk.previews.map((p) => [p.enrollmentId, p]));

  const reminderCountByEnrollment = new Map<string, number>();
  const lastByEnrollment = new Map<string, string>();
  for (const l of [...blockedLogs, ...expiringLogs, ...installmentLogs]) {
    if (!l.course_enrollment_id) continue;
    if (!["SENT", "DELIVERED", "QUEUED"].includes(l.status)) continue;
    reminderCountByEnrollment.set(
      l.course_enrollment_id,
      (reminderCountByEnrollment.get(l.course_enrollment_id) || 0) + 1,
    );
    const at = l.sent_at || l.created_at;
    const prev = lastByEnrollment.get(l.course_enrollment_id);
    if (!prev || prev < at) lastByEnrollment.set(l.course_enrollment_id, at);
  }

  const callTaskByEnrollment = new Map<string, { status: string; reason: string | null }>();
  const db = getSupabaseAdmin();
  if (db && riskIds.length) {
    const { data: tasks } = await db
      .from("collections_call_tasks")
      .select("course_enrollment_id,status,reason,updated_at")
      .in("course_enrollment_id", riskIds)
      .order("updated_at", { ascending: false });
    for (const t of tasks || []) {
      const id = String(t.course_enrollment_id);
      if (callTaskByEnrollment.has(id)) continue;
      callTaskByEnrollment.set(id, { status: String(t.status || "open"), reason: t.reason ? String(t.reason) : null });
    }
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
      const daysOverdue = daysOverdueFromSchedule(e, now);
      const resolved = resolveInstallmentForEnrollment(e, now);
      const installmentNo = resolved.ok ? resolved.resolved.installmentNo : null;
      const cap = capByEnrollment.get(e.id);
      const d = deriveEnrollment(e, now);
      const fail = failureByEnrollment.get(e.id);
      const preview = previewByEnrollment.get(e.id);
      const nextUnpaid = nextUnpaidDatedLine(e.schedule);
      const needsCall = !!cap?.needs_call;
      // remindEnabled = can SMS; selection is independent (every row selectable).
      const remindEnabled = !!preview?.sendable;
      const inactionReason = remindEnabled ? null : humanRemindInaction({
        blockReason: preview?.blockReason,
        blockDetail: preview?.blockDetail,
        needsCall,
        needsCallReason: cap?.excluded_reason ?? null,
        grantExpiresAt: grant?.expires_at ?? null,
        nextUnpaid,
        scheduleStatus: schedule.status,
      });
      const digits = normalizeIndianMobile(e.phone).digits10;
      const buyer = digits ? buyersByPhone.get(digits) : undefined;
      const totalFee = e.total_fee || 0;
      const amountPaid = d.paid;
      const pctPaid = d.progressPct;
      const callTask = callTaskByEnrollment.get(e.id) || null;
      return {
        enrollmentId: e.id,
        studentId: e.student_id ?? null,
        phone: e.phone,
        student: e.student_name,
        email: e.email,
        loginCode: buyer?.status === "ok" ? (buyer.login_code || null) : null,
        courseId: e.course_id,
        courseTitle: e.course_title || byId.get(e.course_id)?.title || "Course",
        batchLabel: e.batch_label,
        planType: e.plan_type,
        enrollmentStatus: e.status,
        amountDue: schedule.amountDue ?? Math.max(0, totalFee - amountPaid),
        amountPaid,
        totalFee,
        pctPaid,
        daysOverdue,
        dueDate: nextUnpaid?.due ? String(nextUnpaid.due).slice(0, 10) : null,
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
        remindersSent: reminderCountByEnrollment.get(e.id) ?? 0,
        needsCall,
        needsCallReason: cap?.excluded_reason ?? null,
        lastRemindedAt: lastByEnrollment.get(e.id) ?? cap?.last_auto_sent_at ?? null,
        lastContactAt: lastByEnrollment.get(e.id) ?? cap?.last_auto_sent_at ?? null,
        callTaskStatus: callTask?.status ?? (needsCall ? "flagged" : null),
        callTaskReason: callTask?.reason ?? cap?.excluded_reason ?? null,
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

  const settings = await getAccessReminderSettings();

  const blocked = rows.filter((r) => r.scheduleAccess.status === "blocked").length;
  const grace = rows.filter((r) => r.scheduleAccess.status === "grace").length;
  const moneyOverdue = rows.filter((r) => r.daysOverdue > 0).length;

  const accessTemplateIds = new Set([ACCESS_BLOCKED_TEMPLATE_ID, ACCESS_EXPIRING_TEMPLATE_ID]);
  const remindersSentToday = todayAccessLogs.filter((l) => {
    if (!l.template_id || !accessTemplateIds.has(l.template_id)) return false;
    if (!["SENT", "DELIVERED", "QUEUED"].includes(l.status)) return false;
    const at = l.sent_at || l.created_at;
    return istYMD(at) === todayYmd;
  }).length;

  const outstandingByTier: Record<string, number> = {};
  let totalOutstanding = 0;
  for (const r of rows) {
    const tier = (r.planType || "unknown").toLowerCase();
    const amt = r.amountDue || 0;
    outstandingByTier[tier] = (outstandingByTier[tier] || 0) + amt;
    totalOutstanding += amt;
  }

  const summary: AccessRiskSummaryData = {
    blockedCount: blocked,
    graceCount: grace,
    activeExtensions: rows.filter((r) => r.grant?.expiresAt).length,
    outstandingByTier,
    remindersSentToday,
    totalOutstanding,
  };

  // Ladder step counts (separate from ACCESS_AUTO_CAP) — additive table may be empty pre-migration.
  let ladderByEnrollment = new Map<string, number>();
  try {
    const { listLadderStepCounts } = await import("@/lib/sms/installmentLadderStore");
    ladderByEnrollment = await listLadderStepCounts(rows.map((r) => r.enrollmentId));
  } catch {
    ladderByEnrollment = new Map();
  }

  const pendingProofByEnrollment = new Map<
    string,
    { id: string; filesCount: number; submittedAt: string; ageMinutes: number }
  >();
  let pendingProofCount = 0;
  if (db && riskIds.length) {
    const { data: pendingProofs } = await db
      .from("installment_payment_proofs")
      .select("id, course_enrollment_id, submitted_at, files")
      .eq("status", "pending")
      .in("course_enrollment_id", riskIds);
    for (const p of pendingProofs || []) {
      pendingProofCount += 1;
      const enrId = String(p.course_enrollment_id);
      const submittedAt = String(p.submitted_at);
      const ageMinutes = Math.max(0, Math.floor((now - new Date(submittedAt).getTime()) / 60_000));
      const entry = {
        id: String(p.id),
        filesCount: Array.isArray(p.files) ? p.files.length : 0,
        submittedAt,
        ageMinutes,
      };
      const prev = pendingProofByEnrollment.get(enrId);
      if (!prev || submittedAt < prev.submittedAt) {
        pendingProofByEnrollment.set(enrId, entry);
      }
    }
  }

  const rowsWithLadder = rows.map((r) => ({
    ...r,
    ladderUsed: ladderByEnrollment.get(r.enrollmentId) ?? 0,
    ladderCap: 5,
    pendingProof: pendingProofByEnrollment.get(r.enrollmentId) ?? null,
  }));

  // Kept for API compat — UI no longer shows leakage report.
  const activeGrants = rowsWithLadder.filter((r) => r.grant).map((r) => ({
    student: r.student,
    phone: r.phone,
    courseTitle: r.courseTitle,
    expiresAt: r.grant!.expiresAt,
    createdBy: r.grant!.createdBy,
    reason: r.grant!.note,
    amountDue: r.amountDue,
    scheduleStatus: r.scheduleAccess.status,
  }));

  return {
    ok: true as const,
    rows: rowsWithLadder,
    pendingProofCount,
    summary,
    grants: activeGrants,
    paymentFailureTotals: failureScan.totals,
    indefiniteOverrides: overrides.filter((o) => o.mode === "grant" && !o.expires_at).length,
    listMeta: {
      total: rowsWithLadder.length,
      remindEnabled: rowsWithLadder.filter((r) => r.remindEnabled).length,
      notActionable: rowsWithLadder.filter((r) => !r.remindEnabled).length,
      genuinelyBlocked: blocked,
      genuinelyGrace: grace,
      moneyOverdueAligned: moneyOverdue,
      note: "Counts from lectureAccessForCourse only (no due-date heuristics).",
    },
    automation: {
      killSwitch: settings.killSwitch,
      enabled: settings.enabled,
      dryRun: settings.dryRun,
      rampLimit: settings.rampLimit,
      dailyCeiling: settings.dailyCeiling,
      quietHours: accessInQuietHours(now),
    },
  };
}
