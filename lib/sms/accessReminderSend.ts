/**
 * Send access-risk reminders (manual single / bulk). Same follow-up scheduling
 * as installment reminders — reuses scheduleFollowUp + Installment Instructions.
 */
import { getCourseEnrollmentById } from "../dataProvider";
import { sendBatch, sendSms } from "./service";
import { listLogsByCampaign } from "./store";
import {
  buildAccessReminder,
  buildBulkAccessReminders,
  type AccessReminderBlockReason,
  type AccessReminderPreview,
} from "./accessReminderService";
import { scheduleFollowUp } from "./installmentFollowUp";
import { isRemindedStatus } from "./installmentAttribution";
import {
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
} from "./accessReminderConstants";
import type { CourseEnrollment } from "../types";

const ACCESS_TEMPLATE_SET = new Set([ACCESS_BLOCKED_TEMPLATE_ID, ACCESS_EXPIRING_TEMPLATE_ID]);

export interface AccessSendResult {
  ok: true;
  requested: number;
  sent: number;
  failed: number;
  skipped: Record<string, number>;
  mode: string;
  balance: number | null;
  excludedByReason: Record<string, number>;
  followUpsScheduled: number;
  previews: AccessReminderPreview[];
  sendablePreviews: AccessReminderPreview[];
}

export interface AccessSendRefusal {
  ok: false;
  kind: "template" | "none_sendable";
  reason: AccessReminderBlockReason | null;
  detail: string | null;
  excludedByReason: Record<string, number>;
}

export async function sendAccessReminderOne(input: {
  enrollmentId: string;
  actorUserId: string | null;
  allowRecentOverride?: boolean;
  scheduleFollowUps?: boolean;
}): Promise<
  | { ok: true; logId: string | null; status: string; preview: AccessReminderPreview; followUpScheduled: boolean }
  | { ok: false; reason: AccessReminderBlockReason | null; detail: string; skipped?: string }
> {
  const preview = await buildAccessReminder({ enrollmentId: input.enrollmentId });
  if (!preview.sendable || !preview.templateId) {
    return { ok: false, reason: preview.blockReason, detail: preview.blockDetail || "This reminder cannot be sent." };
  }

  const enrollment = await getCourseEnrollmentById(input.enrollmentId);
  if (!enrollment) return { ok: false, reason: "enrollment_not_found", detail: "Enrollment not found." };

  const variables = Object.fromEntries(preview.variables.map((v) => [v.token, v.value]));
  const result = await sendSms({
    mobile: enrollment.phone,
    templateId: preview.templateId,
    variables,
    relatedEntity: {
      student_name: enrollment.student_name,
      course_id: enrollment.course_id,
      user_id: enrollment.student_id ?? null,
    },
    sentBy: { userId: input.actorUserId, type: "ADMIN" },
    triggerEvent: "manual_access_reminder",
    audienceType: "access_risk",
    installmentKey: preview.installmentKey,
    allowRecentOverride: !!input.allowRecentOverride,
  });

  if (!result.ok) {
    return { ok: false, reason: "render_blocked", detail: result.error || result.skipped || "Send failed.", skipped: result.skipped };
  }

  let followUpScheduled = false;
  if (input.scheduleFollowUps !== false && result.logId && preview.installmentKey) {
    const { normalizeIndianMobile } = await import("../phone");
    const digits = normalizeIndianMobile(enrollment.phone).digits10;
    if (digits) {
      const queued = await scheduleFollowUp({
        parentSendId: result.logId,
        normalizedMobile: digits,
        courseEnrollmentId: preview.installmentKey.courseEnrollmentId,
        installmentNo: preview.installmentKey.installmentNo,
        installmentFingerprint: preview.installmentKey.fingerprint,
        studentName: enrollment.student_name,
        studentId: enrollment.student_id ?? null,
        courseId: enrollment.course_id,
        actorUserId: input.actorUserId,
      });
      followUpScheduled = queued.ok;
    }
  }

  return {
    ok: true,
    logId: result.logId ?? null,
    status: result.status ?? "UNKNOWN",
    preview,
    followUpScheduled,
  };
}

export async function sendAccessReminderBatch(input: {
  enrollmentIds: string[];
  jobId: string;
  actorUserId: string | null;
  allowRecentOverride?: boolean;
  scheduleFollowUps?: boolean;
}): Promise<AccessSendResult | AccessSendRefusal> {
  const preview = await buildBulkAccessReminders(input.enrollmentIds);
  if (preview.blockReason) {
    return { ok: false, kind: "template", reason: preview.blockReason, detail: preview.blockDetail, excludedByReason: preview.excludedByReason };
  }

  const sendable = preview.previews.filter((p) => p.sendable && p.templateId);
  if (!sendable.length) {
    return {
      ok: false, kind: "none_sendable", reason: null,
      detail: "None of the selected students can be sent an access reminder.",
      excludedByReason: preview.excludedByReason,
    };
  }

  // Group by template — sendBatch is one template at a time.
  const byTemplate = new Map<string, AccessReminderPreview[]>();
  for (const p of sendable) {
    const list = byTemplate.get(p.templateId) || [];
    list.push(p);
    byTemplate.set(p.templateId, list);
  }

  const enrollments = new Map<string, CourseEnrollment>();
  for (const e of await Promise.all(sendable.map((p) => getCourseEnrollmentById(p.enrollmentId)))) {
    if (e) enrollments.set(e.id, e);
  }

  let requested = 0, sent = 0, failed = 0;
  const skipped: Record<string, number> = {};
  let mode = "live";
  let balance: number | null = null;

  for (const [templateId, group] of byTemplate) {
    const recipients = group.flatMap((p) => {
      const e = enrollments.get(p.enrollmentId);
      if (!e) return [];
      return [{
        mobile: e.phone,
        variables: Object.fromEntries(p.variables.map((v) => [v.token, v.value])),
        relatedEntity: {
          student_name: e.student_name,
          course_id: e.course_id,
          user_id: e.student_id ?? null,
        },
        installmentKey: p.installmentKey,
      }];
    });

    const result = await sendBatch({
      recipients,
      templateId,
      sentBy: { userId: input.actorUserId, type: "ADMIN" },
      audienceType: "access_risk",
      triggerEvent: "manual_access_reminder",
      campaignId: input.jobId,
      allowRecentOverride: !!input.allowRecentOverride,
    });
    requested += result.requested;
    sent += result.sent;
    failed += result.failed;
    mode = result.mode;
    balance = result.balance;
    for (const [k, v] of Object.entries(result.skipped)) skipped[k] = (skipped[k] || 0) + v;
  }

  const followUpsScheduled = input.scheduleFollowUps === false
    ? 0
    : await scheduleAccessFollowUpsForJob(input.jobId, sendable, input.actorUserId);

  return {
    ok: true,
    requested, sent, failed, skipped, mode, balance,
    excludedByReason: preview.excludedByReason,
    followUpsScheduled,
    previews: preview.previews,
    sendablePreviews: sendable,
  };
}

export async function scheduleAccessFollowUpsForJob(
  jobId: string,
  sendable: { enrollmentId: string; studentName: string }[],
  actorUserId: string | null,
): Promise<number> {
  const logs = await listLogsByCampaign(jobId).catch(() => []);
  const byEnrollment = new Map(sendable.map((p) => [p.enrollmentId, p]));

  let scheduled = 0;
  for (const log of logs) {
    if (!isRemindedStatus(log.status)) continue;
    if (!log.template_id || !ACCESS_TEMPLATE_SET.has(log.template_id)) continue;
    if (!log.course_enrollment_id || log.installment_no == null || !log.normalized_mobile) continue;
    const source = byEnrollment.get(log.course_enrollment_id);
    const queued = await scheduleFollowUp({
      parentSendId: log.id,
      normalizedMobile: log.normalized_mobile,
      courseEnrollmentId: log.course_enrollment_id,
      installmentNo: log.installment_no,
      installmentFingerprint: log.installment_fingerprint ?? null,
      studentName: log.student_name ?? source?.studentName ?? null,
      studentId: log.user_id ?? null,
      courseId: log.course_id ?? null,
      jobId,
      actorUserId,
    });
    if (queued.ok && !queued.duplicate) scheduled++;
  }
  return scheduled;
}
