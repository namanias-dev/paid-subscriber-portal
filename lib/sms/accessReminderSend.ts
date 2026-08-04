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
  ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID,
} from "./accessReminderConstants";
import {
  accessPhonesSentToday,
  enrollmentNeedsCallSet,
  logManualAccessBulkRun,
  remainingAccessDailyBudget,
  templateBreakdown,
} from "./accessBulkGuards";
import { normalizeIndianMobile } from "../phone";
import { getActionActor } from "../adminGuard";
import { getSupabaseAdmin } from "../supabase";
import type { CourseEnrollment } from "../types";

const ACCESS_TEMPLATE_SET = new Set([
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
  ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID,
]);

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
  // installment_reminder already carries login URL + code — drop +30m instructions.
  const wantFollowUp =
    input.scheduleFollowUps !== false &&
    preview.templateId !== ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID;
  if (wantFollowUp && result.logId && preview.installmentKey) {
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
  now?: number;
}): Promise<AccessSendResult | AccessSendRefusal> {
  const now = input.now ?? Date.now();
  const budget = await remainingAccessDailyBudget(now);

  if (budget.killSwitch) {
    return {
      ok: false, kind: "none_sendable", reason: "kill_switch",
      detail: "Access reminder kill switch is ON — bulk send is disabled.",
      excludedByReason: { kill_switch: input.enrollmentIds.length },
    };
  }
  if (budget.quiet) {
    return {
      ok: false, kind: "none_sendable", reason: "quiet_hours",
      detail: "Quiet hours (outside 09:00–20:00 IST) — bulk access SMS will not send.",
      excludedByReason: { quiet_hours: input.enrollmentIds.length },
    };
  }

  const preview = await buildBulkAccessReminders(input.enrollmentIds, { now });
  if (preview.blockReason) {
    return { ok: false, kind: "template", reason: preview.blockReason, detail: preview.blockDetail, excludedByReason: preview.excludedByReason };
  }

  const needsCall = await enrollmentNeedsCallSet(input.enrollmentIds);
  const phonesToday = await accessPhonesSentToday(now);
  const excludedByReason: Record<string, number> = { ...preview.excludedByReason };
  const bump = (k: string) => { excludedByReason[k] = (excludedByReason[k] || 0) + 1; };

  const enrollments = new Map<string, CourseEnrollment>();
  for (const e of await Promise.all(input.enrollmentIds.map((id) => getCourseEnrollmentById(id)))) {
    if (e) enrollments.set(e.id, e);
  }

  let sendable = preview.previews.filter((p) => p.sendable && p.templateId);
  const afterSilencers: AccessReminderPreview[] = [];
  for (const p of sendable) {
    if (needsCall.has(p.enrollmentId)) { bump("needs_call"); continue; }
    const e = enrollments.get(p.enrollmentId);
    const digits = e ? normalizeIndianMobile(e.phone).digits10 : null;
    if (digits && phonesToday.has(digits)) { bump("already_sent_today"); continue; }
    afterSilencers.push(p);
  }
  sendable = afterSilencers;

  if (sendable.length > budget.remaining) {
    const kept = sendable.slice(0, budget.remaining);
    for (let i = budget.remaining; i < sendable.length; i++) bump("daily_ceiling");
    sendable = kept;
  }

  if (!sendable.length) {
    return {
      ok: false, kind: "none_sendable", reason: null,
      detail: "None of the selected students can be sent an access reminder.",
      excludedByReason,
    };
  }

  // Group by template — sendBatch is one template at a time.
  const byTemplate = new Map<string, AccessReminderPreview[]>();
  for (const p of sendable) {
    const list = byTemplate.get(p.templateId) || [];
    list.push(p);
    byTemplate.set(p.templateId, list);
  }

  let requested = 0, sent = 0, failed = 0;
  const skipped: Record<string, number> = {};
  let mode = "live";
  let balance: number | null = null;
  const actor = await getActionActor();
  const actorLabel = actor?.name || actor?.id || input.actorUserId || "staff";

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
      // Same-day already filtered above — do not let a 30-min override bypass daily cap.
      allowRecentOverride: false,
    });
    requested += result.requested;
    sent += result.sent;
    failed += result.failed;
    mode = result.mode;
    balance = result.balance;
    for (const [k, v] of Object.entries(result.skipped)) skipped[k] = (skipped[k] || 0) + v;
  }

  // Timeline: sms_logs (surfaced on profile) + explicit override-events row with admin actor.
  await writeAccessReminderTimelineEvents(
    sendable,
    enrollments,
    actorLabel,
    input.actorUserId || actor?.id || null,
    input.jobId,
  );

  const followUpsScheduled = input.scheduleFollowUps === false
    ? 0
    : await scheduleAccessFollowUpsForJob(input.jobId, sendable, input.actorUserId);

  await logManualAccessBulkRun({
    requested,
    sent,
    excluded: Object.values(excludedByReason).reduce((a, b) => a + b, 0),
    haltedReason: "manual_bulk",
    detail: {
      jobId: input.jobId,
      templates: templateBreakdown(sendable),
      actor: actorLabel,
    },
  });

  return {
    ok: true,
    requested, sent, failed, skipped, mode, balance,
    excludedByReason,
    followUpsScheduled,
    previews: preview.previews,
    sendablePreviews: sendable,
  };
}

async function writeAccessReminderTimelineEvents(
  sendable: AccessReminderPreview[],
  enrollments: Map<string, CourseEnrollment>,
  actorLabel: string,
  actorUserId: string | null,
  jobId: string,
): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db || !sendable.length) return;
  const rows = sendable.flatMap((p) => {
    const e = enrollments.get(p.enrollmentId);
    if (!e) return [];
    return [{
      phone: e.phone,
      course_id: e.course_id,
      enrollment_id: p.enrollmentId,
      student_id: e.student_id ?? null,
      event_type: "reminder_sent",
      mode: "grant",
      expires_at: null,
      previous_expires_at: null,
      reason: `Access reminder SMS (${p.templateId}) — installment ${p.installmentNo ?? "?"} · job ${jobId.slice(0, 8)}`,
      actor_user_id: actorUserId,
      actor_name: actorLabel,
      elevated: false,
    }];
  });
  // Chunk inserts; failures must not roll back SMS that already left.
  for (let i = 0; i < rows.length; i += 40) {
    const chunk = rows.slice(i, i + 40);
    await db.from("access_override_events").insert(chunk).then(() => undefined, () => undefined);
  }
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
    // No +30m follow-up for installment_reminder primary.
    if (log.template_id === ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID) continue;
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
