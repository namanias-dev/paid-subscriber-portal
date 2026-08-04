/**
 * Unified access actions — one handler each for remind / extend / revoke /
 * create_call_task. Called from Access at Risk, student profile, and API.
 *
 * Course lecture access (course_access_overrides) — NOT LMS students.expiry_date.
 */
import {
  upsertAccessOverride,
  deleteAccessOverride,
  getCourseEnrollmentById,
  getCourseEnrollmentsByPhone,
} from "./dataProvider";
import { validateAccessGrant, ACCESS_GRANT_MAX_DAYS_DEFAULT } from "./accessOverridePolicy";
import { appendStudentAccessEvent } from "./studentAccessEvents";
import { sendAccessReminderOne } from "./sms/accessReminderSend";
import { getSupabaseAdmin } from "./supabase";
import { pauseReminderStreak, clearReminderStreak } from "./sms/installmentReminderStreak";

export type AccessActionActor = { id: string | null; name: string };

async function scheduleFingerprint(phone: string, courseId: string): Promise<string> {
  const rows = await getCourseEnrollmentsByPhone(phone);
  const e = rows.find((r) => r.course_id === courseId && r.status !== "cancelled");
  if (!e) return "";
  return JSON.stringify({
    total_fee: e.total_fee,
    amount_paid: e.amount_paid,
    schedule: e.schedule,
    plan_type: e.plan_type,
  });
}

export async function extendCourseAccess(input: {
  phone: string;
  courseId: string;
  expiresAt: string;
  reason: string;
  actor: AccessActionActor;
  elevated?: boolean;
  enrollmentId?: string | null;
}): Promise<{ ok: true; days: number } | { ok: false; error: string; code?: string }> {
  const reason = input.reason.trim();
  const check = validateAccessGrant({
    expiresAt: input.expiresAt,
    reason,
    elevated: !!input.elevated,
  });
  if (!check.ok) return { ok: false, error: check.detail, code: check.error };

  const before = await scheduleFingerprint(input.phone, input.courseId);
  await upsertAccessOverride({
    phone: input.phone,
    course_id: input.courseId,
    mode: "grant",
    expires_at: input.expiresAt,
    note: reason,
    created_by: input.actor.name || input.actor.id || "admin",
  });
  const after = await scheduleFingerprint(input.phone, input.courseId);
  if (before !== after) {
    await deleteAccessOverride(input.phone, input.courseId);
    return { ok: false, error: "Grant appeared to change the payment schedule — aborted." };
  }

  await pauseReminderStreak({
    courseEnrollmentId: input.enrollmentId ?? null,
    phone: input.phone,
    courseId: input.courseId,
    reason: "extension_granted",
  });

  await appendStudentAccessEvent({
    phone: input.phone,
    courseId: input.courseId,
    courseEnrollmentId: input.enrollmentId ?? null,
    eventType: "extension_granted",
    actor: input.actor.name || input.actor.id || "admin",
    channel: "admin",
    reason,
    meta: { days: check.days, expires_at: input.expiresAt },
  });

  return { ok: true, days: check.days };
}

export async function revokeCourseExtension(input: {
  phone: string;
  courseId: string;
  actor: AccessActionActor;
  reason?: string | null;
  enrollmentId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await deleteAccessOverride(input.phone, input.courseId);

  // Streak may resume on next scan once grant is gone (not permanently cleared).
  await pauseReminderStreak({
    courseEnrollmentId: input.enrollmentId ?? null,
    phone: input.phone,
    courseId: input.courseId,
    reason: null,
    unpause: true,
  });

  await appendStudentAccessEvent({
    phone: input.phone,
    courseId: input.courseId,
    courseEnrollmentId: input.enrollmentId ?? null,
    eventType: "extension_revoked",
    actor: input.actor.name || input.actor.id || "admin",
    channel: "admin",
    reason: input.reason?.trim() || "Revoked by staff",
  });

  return { ok: true };
}

export async function remindCourseAccess(input: {
  enrollmentId: string;
  actor: AccessActionActor;
  allowRecentOverride?: boolean;
}): Promise<
  | { ok: true; logId: string | null; followUpScheduled: boolean }
  | { ok: false; error: string; reason?: string | null }
> {
  const result = await sendAccessReminderOne({
    enrollmentId: input.enrollmentId,
    actorUserId: input.actor.id,
    allowRecentOverride: input.allowRecentOverride,
    scheduleFollowUps: true,
  });
  if (!result.ok) {
    const e = await getCourseEnrollmentById(input.enrollmentId);
    await appendStudentAccessEvent({
      studentId: e?.student_id ?? null,
      phone: e?.phone || "",
      courseId: e?.course_id ?? null,
      courseEnrollmentId: input.enrollmentId,
      eventType: "reminder_failed",
      actor: input.actor.name || input.actor.id || "admin",
      channel: "sms",
      reason: result.detail,
      meta: { blockReason: result.reason },
    });
    return { ok: false, error: result.detail, reason: result.reason };
  }

  const e = await getCourseEnrollmentById(input.enrollmentId);
  await appendStudentAccessEvent({
    studentId: e?.student_id ?? null,
    phone: e?.phone || "",
    courseId: e?.course_id ?? null,
    courseEnrollmentId: input.enrollmentId,
    eventType: "reminder_sent",
    actor: input.actor.name || input.actor.id || "admin",
    channel: "sms",
    templateId: result.preview.templateId,
    bodySent: result.preview.body,
    installmentNo: result.preview.installmentKey?.installmentNo ?? null,
    relatedEventId: result.logId,
    meta: { followUpScheduled: result.followUpScheduled },
  });

  return { ok: true, logId: result.logId, followUpScheduled: result.followUpScheduled };
}

export async function createCollectionsCallTask(input: {
  enrollmentId: string;
  actor: AccessActionActor;
  reason?: string;
  installmentNo?: number | null;
  amountDue?: number | null;
  daysOverdue?: number | null;
}): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const e = await getCourseEnrollmentById(input.enrollmentId);
  if (!e) return { ok: false, error: "Enrollment not found" };
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Database not configured" };

  const reason = input.reason || "manual_call_task";
  const { error } = await db.from("collections_call_tasks").upsert(
    {
      course_enrollment_id: e.id,
      installment_no: input.installmentNo ?? null,
      student_name: e.student_name,
      phone: e.phone,
      amount_due: input.amountDue ?? null,
      days_overdue: input.daysOverdue ?? null,
      reason,
      status: "open",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "course_enrollment_id,installment_no,reason", ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: error.message };

  await appendStudentAccessEvent({
    studentId: e.student_id ?? null,
    phone: e.phone,
    courseId: e.course_id,
    courseEnrollmentId: e.id,
    eventType: "call_task_created",
    actor: input.actor.name || input.actor.id || "admin",
    channel: "call_task",
    amount: input.amountDue ?? null,
    installmentNo: input.installmentNo ?? null,
    reason,
  });

  return { ok: true, created: true };
}

export { ACCESS_GRANT_MAX_DAYS_DEFAULT };

/** Stop daily reminder streak when installment is paid (called from PAID side effects). */
export async function stopRemindersOnPaid(input: {
  phone: string;
  enrollmentId?: string | null;
  courseId?: string | null;
}): Promise<void> {
  await clearReminderStreak({
    courseEnrollmentId: input.enrollmentId ?? null,
    phone: input.phone,
    courseId: input.courseId ?? null,
  });
  const { cancelPendingFollowUpsForEnrollment } = await import("./sms/installmentFollowUp");
  if (input.enrollmentId) {
    await cancelPendingFollowUpsForEnrollment(input.enrollmentId, "installment_paid").catch(() => undefined);
  }
}
