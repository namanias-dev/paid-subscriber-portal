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
import { pauseReminderStreak } from "./sms/installmentReminderStreak";
import { getSupabaseAdmin } from "./supabase";

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
}): Promise<{ ok: true; days: number; expiresAt: string } | { ok: false; error: string; code?: string }> {
  const reason = input.reason.trim();
  const check = validateAccessGrant({
    expiresAt: input.expiresAt,
    reason,
    elevated: !!input.elevated,
  });
  if (!check.ok) return { ok: false, error: check.detail, code: check.error };

  // Loosen-only: never shorten an existing dated grant.
  // e.g. grandfather to 12 Aug + provisional now+7d (11 Aug) → keep 12 Aug.
  const db = getSupabaseAdmin();
  let effectiveExpiresAt = input.expiresAt;
  if (db) {
    const { data: existing } = await db
      .from("course_access_overrides")
      .select("mode,expires_at")
      .eq("phone", input.phone.trim())
      .eq("course_id", input.courseId)
      .maybeSingle();
    if (existing?.mode === "grant" && existing.expires_at) {
      const existingMs = Date.parse(String(existing.expires_at));
      const newMs = Date.parse(input.expiresAt);
      if (Number.isFinite(existingMs) && Number.isFinite(newMs) && existingMs > newMs) {
        effectiveExpiresAt = String(existing.expires_at);
      }
    }
  }

  const before = await scheduleFingerprint(input.phone, input.courseId);
  await upsertAccessOverride({
    phone: input.phone,
    course_id: input.courseId,
    mode: "grant",
    expires_at: effectiveExpiresAt,
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

  const effectiveDays = Math.max(
    1,
    Math.ceil((Date.parse(effectiveExpiresAt) - Date.now()) / 86_400_000),
  );

  await appendStudentAccessEvent({
    phone: input.phone,
    courseId: input.courseId,
    courseEnrollmentId: input.enrollmentId ?? null,
    eventType: "extension_granted",
    actor: input.actor.name || input.actor.id || "admin",
    channel: "admin",
    reason,
    meta: {
      days: effectiveDays,
      expires_at: effectiveExpiresAt,
      requested_expires_at: input.expiresAt,
      loosen_only: effectiveExpiresAt !== input.expiresAt,
    },
  });

  return { ok: true, days: effectiveDays, expiresAt: effectiveExpiresAt };
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
  const { sendAccessReminderOne } = await import("./sms/accessReminderSend");
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
  /** Next instalment amount (logged on timeline only). */
  amountDue?: number | null;
  /** Total fee − paid. Stored as amount_due — the number staff should quote. */
  outstanding?: number | null;
  daysOverdue?: number | null;
}): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const e = await getCourseEnrollmentById(input.enrollmentId);
  if (!e) return { ok: false, error: "Enrollment not found" };
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Database not configured" };

  const outstanding =
    input.outstanding != null
      ? input.outstanding
      : Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0));
  // Keep reason stable — unique (enrollment, installment_no, reason).
  const reason = input.reason || "manual_call_task";

  const { error } = await db.from("collections_call_tasks").upsert(
    {
      course_enrollment_id: e.id,
      installment_no: input.installmentNo ?? null,
      student_name: e.student_name,
      phone: e.phone,
      // Staff quote = total outstanding (not next-instalment line alone).
      amount_due: outstanding,
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
    amount: outstanding,
    installmentNo: input.installmentNo ?? null,
    reason:
      input.amountDue != null
        ? `${reason} · instalment ₹${Math.round(input.amountDue).toLocaleString("en-IN")} · outstanding ₹${Math.round(outstanding).toLocaleString("en-IN")}`
        : reason,
  });

  return { ok: true, created: true };
}

export { ACCESS_GRANT_MAX_DAYS_DEFAULT };
