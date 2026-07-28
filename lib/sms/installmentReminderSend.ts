/**
 * The one implementation of "send installment reminders to these enrollments".
 *
 * Extracted from the bulk route so that a second entry point cannot become a
 * second send path. Callers differ only in how they decide WHO to send to — staff
 * selection, or a log-derived retry set — and in how they authenticate. What
 * happens to a recipient after that point is identical for all of them: the same
 * re-resolution, the same per-recipient render, the same screening inside
 * `sendBatch`, the same audit rows, and the same step-2 scheduling.
 */
import { getCourseEnrollmentById } from "../dataProvider";
import { sendBatch } from "./service";
import { listLogsByCampaign } from "./store";
import {
  buildBulkInstallmentReminders,
  INSTALLMENT_REMINDER_TEMPLATE_ID,
  type InstallmentReminderPreview,
  type ReminderBlockReason,
} from "./installmentReminderService";
import { scheduleFollowUp } from "./installmentFollowUp";
import { isRemindedStatus } from "./installmentAttribution";
import type { CourseEnrollment } from "../types";

export interface ReminderSendResult {
  ok: true;
  requested: number;
  sent: number;
  failed: number;
  skipped: Record<string, number>;
  mode: string;
  balance: number | null;
  excludedByReason: Record<string, number>;
  followUpsScheduled: number;
  previews: InstallmentReminderPreview[];
  sendablePreviews: InstallmentReminderPreview[];
}

export interface ReminderSendRefusal {
  ok: false;
  /** `template` — the job as a whole cannot run. `none_sendable` — nobody is left. */
  kind: "template" | "none_sendable";
  reason: ReminderBlockReason | null;
  detail: string | null;
  excludedByReason: Record<string, number>;
}

/**
 * Re-resolve, render, screen, send, then queue step 2.
 *
 * The re-resolution is not redundant with whatever the caller already knows: it is
 * the moment a student who has paid since being selected drops out. For a retry
 * hours after the original send, it is the only thing standing between a settled
 * account and another demand for money.
 */
export async function sendInstallmentReminderBatch(input: {
  enrollmentIds: string[];
  /** Groups the job's logs; also the replay key the callers check beforehand. */
  jobId: string;
  overdueOnly?: boolean;
  actorUserId: string | null;
  /**
   * Deliberate repeat inside the 30-minute same-template window. A retry must
   * pass false: a FAILED attempt is not a hit on that guard, so it needs no
   * override, and overriding is what once turned a retry into 76 duplicates.
   */
  allowRecentOverride?: boolean;
  /** Queue the +30min instructions for everyone whose reminder actually sent. */
  scheduleFollowUps?: boolean;
}): Promise<ReminderSendResult | ReminderSendRefusal> {
  const overdueOnly = input.overdueOnly !== false;

  const preview = await buildBulkInstallmentReminders(input.enrollmentIds, { overdueOnly });
  if (preview.blockReason) {
    return { ok: false, kind: "template", reason: preview.blockReason, detail: preview.blockDetail, excludedByReason: preview.excludedByReason };
  }

  const sendable = preview.previews.filter((p) => p.sendable);
  if (!sendable.length) {
    return {
      ok: false, kind: "none_sendable", reason: null,
      detail: "None of the selected students can be sent a reminder.",
      excludedByReason: preview.excludedByReason,
    };
  }

  const enrollments = new Map<string, CourseEnrollment>();
  for (const e of await Promise.all(sendable.map((p) => getCourseEnrollmentById(p.enrollmentId)))) {
    if (e) enrollments.set(e.id, e);
  }

  const recipients = sendable.flatMap((p) => {
    const e = enrollments.get(p.enrollmentId);
    if (!e) return [];
    return [{
      mobile: e.phone,
      // The previewed values travel with the recipient so the send-time render
      // reproduces the approved body exactly, per recipient, never reused.
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
    templateId: INSTALLMENT_REMINDER_TEMPLATE_ID,
    sentBy: { userId: input.actorUserId, type: "ADMIN" },
    audienceType: "installment_reminder",
    triggerEvent: "manual_installment_reminder",
    campaignId: input.jobId,
    allowRecentOverride: !!input.allowRecentOverride,
  });

  const followUpsScheduled = input.scheduleFollowUps === false
    ? 0
    : await scheduleFollowUpsForJob(input.jobId, sendable, input.actorUserId);

  return {
    ok: true,
    requested: result.requested,
    sent: result.sent,
    failed: result.failed,
    skipped: result.skipped,
    mode: result.mode,
    balance: result.balance,
    excludedByReason: preview.excludedByReason,
    followUpsScheduled,
    previews: preview.previews,
    sendablePreviews: sendable,
  };
}

/**
 * Queue an instructions follow-up for every log in this job that reached the
 * gateway. Keyed off the log's own installment columns, so the follow-up is
 * provably about the same line the reminder named — and the unique index means a
 * re-run of this function schedules nothing new.
 */
export async function scheduleFollowUpsForJob(
  jobId: string,
  sendable: { enrollmentId: string; studentName: string }[],
  actorUserId: string | null,
): Promise<number> {
  // The send log is the source of truth for who actually went out, not the intent
  // list: `sendBatch` reports aggregate counts, and a recipient it dropped at the
  // last moment must not get a follow-up.
  const logs = await listLogsByCampaign(jobId).catch(() => []);
  const byEnrollment = new Map(sendable.map((p) => [p.enrollmentId, p]));

  let scheduled = 0;
  for (const log of logs) {
    if (!isRemindedStatus(log.status)) continue;
    if (log.template_id !== INSTALLMENT_REMINDER_TEMPLATE_ID) continue;
    if (!log.course_enrollment_id || log.installment_no == null) continue;
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
