/**
 * Grandfather / classic-grace notice queue sender — Mission Control–visible SYSTEM sends.
 * Only rows with armed=true + scheduled_for_ymd=today IST + not yet sent.
 *
 * Cohorts:
 *   pilot_10 / queued_53  → installment_reminder (amount + login code)
 *   classic_grace_10      → portal_access_blocked (stay locked, no grant) + call task
 */
import { getSupabaseAdmin } from "../supabase";
import { getCourseEnrollmentById } from "../dataProvider";
import { sendSms } from "./service";
import { buildInstallmentReminder } from "./installmentReminderService";
import { buildAccessReminder } from "./accessReminderService";
import { appendStudentAccessEvent } from "../studentAccessEvents";
import { istYMD } from "../dates";
import { getRule, touchRuleLastRun } from "./store";
import { ACCESS_BLOCKED_TEMPLATE_ID } from "./accessReminderConstants";
import { createCollectionsCallTask } from "../accessActions";

export const GRANDFATHER_TEMPLATE_ID = "installment_reminder";

export interface GrandfatherDrainResult {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
  details: { enrollmentId: string; name: string | null; ok: boolean; error?: string; logId?: string | null }[];
}

export async function drainArmedGrandfatherNotices(opts?: {
  cohort?: "pilot_10" | "queued_53" | "classic_grace_10";
  now?: number;
  dryRun?: boolean;
}): Promise<GrandfatherDrainResult> {
  const out: GrandfatherDrainResult = { scanned: 0, sent: 0, failed: 0, skipped: 0, details: [] };
  const db = getSupabaseAdmin();
  if (!db) return out;

  const now = opts?.now ?? Date.now();
  const today = istYMD(new Date(now))!;

  let q = db
    .from("grandfather_notice_queue")
    .select("*")
    .eq("armed", true)
    .eq("scheduled_for_ymd", today)
    .is("sent_at", null);
  if (opts?.cohort) q = q.eq("cohort", opts.cohort);

  const { data: rows } = await q.limit(100);
  const list = rows || [];
  out.scanned = list.length;
  if (!list.length) return out;

  // Soft gate: MC rule should exist; do not require enabled (queue.armed is the arm switch).
  await getRule("installment_access_reminder");

  for (const row of list) {
    const enrollmentId = String(row.course_enrollment_id);
    const name = row.student_name ? String(row.student_name) : null;
    const meta = (row.meta || {}) as { excluded_missing_login_code?: boolean };

    if (meta.excluded_missing_login_code) {
      out.skipped++;
      out.details.push({ enrollmentId, name, ok: false, error: "excluded_missing_login_code" });
      continue;
    }

    const isClassicGrace = row.cohort === "classic_grace_10";
    const expectedTemplate = isClassicGrace ? ACCESS_BLOCKED_TEMPLATE_ID : GRANDFATHER_TEMPLATE_ID;

    // classic_grace_10: blocked template (lectures locked, no grandfather grant).
    const preview = isClassicGrace
      ? await buildAccessReminder({ enrollmentId })
      : null;
    const inst = isClassicGrace ? null : await buildInstallmentReminder({ enrollmentId });

    const sendable = isClassicGrace
      ? preview?.sendable && preview.templateId === ACCESS_BLOCKED_TEMPLATE_ID
      : inst?.sendable && inst.templateId === GRANDFATHER_TEMPLATE_ID;

    if (!sendable) {
      const blockReason = isClassicGrace
        ? (preview?.blockReason || "access_not_sendable")
        : (inst?.blockReason || "installment_not_sendable");
      const blockDetail = isClassicGrace
        ? (preview?.blockDetail || blockReason)
        : (inst?.blockDetail || blockReason);
      out.failed++;
      out.details.push({ enrollmentId, name, ok: false, error: blockReason });
      await appendStudentAccessEvent({
        phone: String(row.phone),
        courseEnrollmentId: enrollmentId,
        eventType: "reminder_failed",
        actor: "system",
        channel: "sms",
        templateId: expectedTemplate,
        reason: blockDetail,
      });
      continue;
    }

    const body = isClassicGrace ? preview!.body : inst!.body;
    const templateId = isClassicGrace ? preview!.templateId! : inst!.templateId!;
    const variables = Object.fromEntries(
      (isClassicGrace ? preview!.variables : inst!.variables).map((v) => [v.token, v.value]),
    );
    const installmentKey = isClassicGrace ? preview!.installmentKey : inst!.installmentKey;
    const installmentNo = isClassicGrace ? preview!.installmentNo : inst!.installmentNo;

    if (opts?.dryRun) {
      out.skipped++;
      out.details.push({ enrollmentId, name, ok: true, error: "dry_run" });
      continue;
    }

    const e = await getCourseEnrollmentById(enrollmentId);
    if (!e) {
      out.failed++;
      out.details.push({ enrollmentId, name, ok: false, error: "enrollment_gone" });
      continue;
    }

    const result = await sendSms({
      mobile: e.phone,
      templateId,
      variables,
      relatedEntity: {
        student_name: e.student_name,
        course_id: e.course_id,
        user_id: e.student_id ?? null,
      },
      sentBy: { userId: null, type: "SYSTEM" },
      triggerEvent: isClassicGrace ? "classic_grace_10_blocked" : "grandfather_notice_pilot",
      audienceType: "access_risk",
      installmentKey: installmentKey ?? undefined,
      enforceWindow: true,
      dedupeKey: `${row.cohort}:${enrollmentId}:${today}:${templateId}`,
    });

    if (!result.ok) {
      out.failed++;
      out.details.push({ enrollmentId, name, ok: false, error: result.error || result.skipped || "send_failed" });
      await appendStudentAccessEvent({
        studentId: e.student_id ?? null,
        phone: e.phone,
        courseId: e.course_id,
        courseEnrollmentId: enrollmentId,
        eventType: "reminder_failed",
        actor: "system",
        channel: "sms",
        templateId,
        reason: result.error || result.skipped || "send_failed",
      });
      continue;
    }

    await db.from("grandfather_notice_queue").update({
      sent_at: new Date().toISOString(),
      stage1_log_id: result.logId ?? null,
      updated_at: new Date().toISOString(),
      meta: { ...(row.meta || {}), body_sent: body, template_id: templateId },
    }).eq("course_enrollment_id", enrollmentId);

    await appendStudentAccessEvent({
      studentId: e.student_id ?? null,
      phone: e.phone,
      courseId: e.course_id,
      courseEnrollmentId: enrollmentId,
      eventType: "reminder_sent",
      actor: "system",
      channel: "sms",
      templateId,
      bodySent: body,
      installmentNo: installmentNo ?? null,
      amount: isClassicGrace ? preview!.amountDue : inst!.amountDue,
      relatedEventId: result.logId ?? null,
      meta: { cohort: row.cohort, grandfather: !isClassicGrace, classic_grace: isClassicGrace },
    });

    if (isClassicGrace) {
      await createCollectionsCallTask({
        enrollmentId,
        actor: { id: null, name: "system" },
        reason: "classic_grace_10_blocked_notice",
        installmentNo: installmentNo ?? null,
        amountDue: preview!.amountDue ?? null,
      });
    }

    out.sent++;
    out.details.push({ enrollmentId, name, ok: true, logId: result.logId ?? null });
  }

  if (out.sent > 0) touchRuleLastRun("installment_access_reminder");
  return out;
}

/** Pilot success gate for auto-proceed of queued_53 (≥8/10, no DLT/carrier rejection). */
export async function evaluatePilotDelivery(): Promise<{
  sent: number;
  deliveredOrAccepted: number;
  rejected: number;
  ok: boolean;
  holdReason: string | null;
  perStudent: { name: string | null; status: string; logId: string | null }[];
}> {
  const db = getSupabaseAdmin();
  const empty = { sent: 0, deliveredOrAccepted: 0, rejected: 0, ok: false, holdReason: "no_db", perStudent: [] as { name: string | null; status: string; logId: string | null }[] };
  if (!db) return empty;

  const { data: rows } = await db
    .from("grandfather_notice_queue")
    .select("student_name,sent_at,stage1_log_id,meta")
    .eq("cohort", "pilot_10");
  const list = rows || [];
  const logIds = list.map((r) => r.stage1_log_id).filter(Boolean) as string[];
  const statusByLog = new Map<string, string>();
  if (logIds.length) {
    const { data: logs } = await db.from("sms_logs").select("id,status,error_message").in("id", logIds);
    for (const l of logs || []) statusByLog.set(String(l.id), String(l.status || ""));
  }

  const perStudent = list.map((r) => {
    const logId = r.stage1_log_id ? String(r.stage1_log_id) : null;
    const status = !r.sent_at ? "UNSENT" : (logId ? (statusByLog.get(logId) || "UNKNOWN") : "SENT_NO_LOG");
    return { name: r.student_name ? String(r.student_name) : null, status, logId };
  });

  const sent = perStudent.filter((p) => p.status !== "UNSENT").length;
  const rejected = perStudent.filter((p) =>
    ["FAILED", "REJECTED", "DLT_REJECTED", "EXPIRED"].includes(p.status.toUpperCase()),
  ).length;
  const deliveredOrAccepted = perStudent.filter((p) =>
    ["SENT", "DELIVERED", "QUEUED", "SUBMITTED"].includes(p.status.toUpperCase()),
  ).length;

  let holdReason: string | null = null;
  if (sent < 10) holdReason = `pilot_incomplete:${sent}/10`;
  else if (rejected > 0) holdReason = `pilot_rejections:${rejected}`;
  else if (deliveredOrAccepted < 8) holdReason = `pilot_below_threshold:${deliveredOrAccepted}/10`;

  return {
    sent,
    deliveredOrAccepted,
    rejected,
    ok: !holdReason,
    holdReason,
    perStudent,
  };
}

/** Auto-arm queued_53 for 6 Aug only when pilot clears ≥8/10 with zero rejections. */
export async function maybeAutoArmQueued53(scheduledForYmd = "2026-08-06"): Promise<{
  armed: number;
  held: boolean;
  pilot: Awaited<ReturnType<typeof evaluatePilotDelivery>>;
}> {
  const pilot = await evaluatePilotDelivery();
  if (!pilot.ok) return { armed: 0, held: true, pilot };
  const armed = await armGrandfatherCohort({
    cohort: "queued_53",
    scheduledForYmd,
    scheduleTimeIst: "11:00",
  });
  return { armed, held: false, pilot };
}

export async function armGrandfatherCohort(input: {
  cohort: "pilot_10" | "queued_53" | "classic_grace_10";
  scheduledForYmd: string;
  scheduleTimeIst?: string;
}): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const { data, error } = await db
    .from("grandfather_notice_queue")
    .update({
      armed: true,
      scheduled_for_ymd: input.scheduledForYmd,
      schedule_time_ist: input.scheduleTimeIst || "11:00",
      updated_at: new Date().toISOString(),
    })
    .eq("cohort", input.cohort)
    .eq("armed", false)
    .select("course_enrollment_id");
  if (error) throw new Error(error.message);
  return (data || []).length;
}
