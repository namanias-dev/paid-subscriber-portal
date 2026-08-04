/**
 * Access At Risk AUTOMATION runner.
 *
 * Ship defaults: killSwitch OFF, dryRun ON, enabled FALSE — so a cron tick
 * only LOGS what would send. Real sends require an explicit settings flip.
 *
 * §5 Cadence: TAPER_DAY_OFFSETS (not daily). Gated by MC rule enabled=false.
 * Constants live in accessReminderConstants.ts + accessReminderTaper.ts.
 */
import {
  getAllCourseEnrollments, getAllCourses, getAllAccessOverrides, getCourseEnrollmentById, pageThrough,
} from "../dataProvider";
import { maskMobile, normalizeIndianMobile } from "../phone";
import { istYMD } from "../dates";
import { getSupabaseAdmin } from "../supabase";
import { listLogs } from "./store";
import { sendSms } from "./service";
import { scheduleFollowUp } from "./installmentFollowUp";
import {
  buildAccessReminderContext,
  buildAccessReminderFor,
  activeAccessGrant,
  type AccessReminderPreview,
} from "./accessReminderService";
import { istHour } from "./accessDays";
import {
  ACCESS_AUTO_CAP_PER_INSTALLMENT,
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_DAILY_VOLUME_CEILING,
  ACCESS_EXPIRING_TEMPLATE_ID,
  ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID,
  ACCESS_MANUAL_DEDUP_HOURS,
  ACCESS_MAX_AUTO_PER_PHONE_PER_DAY,
  ACCESS_POST_TRANSFER_SKIP_HOURS,
  ACCESS_QUIET_HOURS_IST,
  ACCESS_RAMP_FIRST_RUN,
  TAPER_HARD_CAP,
} from "./accessReminderConstants";
import { isTaperCallTaskDay, isTaperSendDay } from "./accessReminderTaper";
import {
  getAccessReminderSettings,
  listCapsForEnrollments,
  logAutomationRun,
  recordAutoSequence,
  type AccessCapRow,
  type AccessReminderSettings,
} from "./accessCapStore";
import { heavyCronHalted } from "../incidentHalt";
import { dbCircuitOpen } from "../dbCircuit";

export type AutoSkipReason =
  | "kill_switch"
  | "db_circuit_open"
  | "disabled"
  | "quiet_hours"
  | "not_cadence_day"
  | "streak_paused"
  | "cap_reached"
  | "excluded"
  | "phone_day_dedupe"
  | "manual_recent"
  | "recent_transfer"
  | "preview_blocked"
  | "ramp_limit"
  | "daily_ceiling"
  | "already_auto_today";

export interface AutoCandidate {
  enrollmentId: string;
  studentName: string;
  maskedPhone: string;
  accessStatus: string;
  templateId: string;
  installmentNo: number | null;
  daysLeft: number | null;
  body: string;
  skipReason: AutoSkipReason | null;
  preview: AccessReminderPreview | null;
}

export interface AutoRunReport {
  settings: AccessReminderSettings;
  now: string;
  istHour: number;
  inQuietHours: boolean;
  candidates: AutoCandidate[];
  wouldSend: AutoCandidate[];
  excluded: { reason: string; count: number }[];
  seatBookingOnly: number;
  haltedReason: string | null;
  sent: number;
  dryRun: boolean;
}

function inQuietHours(now: number): boolean {
  const h = istHour(now);
  return h < ACCESS_QUIET_HOURS_IST.startHour || h >= ACCESS_QUIET_HOURS_IST.endHour;
}

async function recentManualAccessSend(digits: Set<string>, now: number): Promise<Set<string>> {
  const since = new Date(now - ACCESS_MANUAL_DEDUP_HOURS * 3600_000).toISOString();
  const [a, b, c] = await Promise.all([
    listLogs({ from: since, templateId: ACCESS_BLOCKED_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_EXPIRING_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID, limit: 5000 }),
  ]);
  const hit = new Set<string>();
  for (const l of [...a, ...b, ...c]) {
    if (!digits.has(l.normalized_mobile)) continue;
    if (l.sent_by_type === "ADMIN") hit.add(l.normalized_mobile);
  }
  return hit;
}

async function autoSentPhonesToday(now: number): Promise<Set<string>> {
  const today = istYMD(new Date(now))!;
  const since = `${today}T00:00:00+05:30`;
  const [a, b, c] = await Promise.all([
    listLogs({ from: since, templateId: ACCESS_BLOCKED_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_EXPIRING_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID, limit: 5000 }),
  ]);
  const hit = new Set<string>();
  for (const l of [...a, ...b, ...c]) {
    if (l.sent_by_type === "SYSTEM" && ["SENT", "DELIVERED", "QUEUED"].includes(l.status)) {
      hit.add(l.normalized_mobile);
    }
  }
  return hit;
}

async function recentTransferEnrollmentIds(now: number): Promise<Set<string>> {
  const db = getSupabaseAdmin();
  if (!db) return new Set();
  const since = new Date(now - ACCESS_POST_TRANSFER_SKIP_HOURS * 3600_000).toISOString();
  const rows = await pageThrough<{ to_enrollment_id: string; from_enrollment_id: string }>(
    () => db.from("enrollment_transfers")
      .select("to_enrollment_id, from_enrollment_id, id")
      .gte("created_at", since)
      .order("id"),
  );
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.to_enrollment_id) ids.add(r.to_enrollment_id);
    if (r.from_enrollment_id) ids.add(r.from_enrollment_id);
  }
  return ids;
}

/**
 * Decide who automation would touch this tick. Pure selection + preview —
 * sending is a separate step gated by settings.
 */
export async function planAccessAutomation(now = Date.now()): Promise<AutoRunReport> {
  const settings = await getAccessReminderSettings();
  const quiet = inQuietHours(now);

  const empty = (haltedReason: string | null): AutoRunReport => ({
    settings, now: new Date(now).toISOString(), istHour: istHour(now), inQuietHours: quiet,
    candidates: [], wouldSend: [], excluded: haltedReason ? [{ reason: haltedReason, count: 0 }] : [],
    seatBookingOnly: 0, haltedReason, sent: 0, dryRun: settings.dryRun,
  });

  if (settings.killSwitch || heavyCronHalted()) return empty("kill_switch");
  if (dbCircuitOpen()) return empty("db_circuit_open");
  if (!settings.enabled && !settings.dryRun) return empty("disabled");
  // Dry-run still plans even when enabled=false so staff can see the table.
  if (quiet && !settings.dryRun) return empty("quiet_hours");

  const [enrollments, courses, overrides, recentTransfers] = await Promise.all([
    getAllCourseEnrollments(),
    getAllCourses(),
    getAllAccessOverrides(),
    recentTransferEnrollmentIds(now),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));

  // ONE shared at-risk definition with the admin list (active paid + schedule risk / grant).
  const { isAccessAtRiskEnrollment } = await import("../accessAtRisk");
  const { lectureAccessForCourse } = await import("../entitlements");
  const risk = enrollments.filter((e) => {
    const ovr = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    const access = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    return isAccessAtRiskEnrollment({ enrollment: e, scheduleAccess: access, override: ovr, now });
  });

  const ctx = await buildAccessReminderContext(risk, { now, courses: byId });
  if (!ctx.ok) return empty(ctx.reason);

  const caps = await listCapsForEnrollments(risk.map((e) => e.id));
  const capKey = (eId: string, no: number) => `${eId}::${no}`;
  const capMap = new Map<string, AccessCapRow>();
  /** Enrollment-level needs_call (e.g. installment_no 0 payment-failure flags). */
  const needsCallByEnrollment = new Set<string>();
  for (const c of caps) {
    capMap.set(capKey(c.course_enrollment_id, c.installment_no), c);
    if (c.needs_call) needsCallByEnrollment.add(c.course_enrollment_id);
  }

  const digits = new Set<string>();
  for (const e of risk) {
    const n = normalizeIndianMobile(e.phone || "");
    if (n.ok && n.digits10) digits.add(n.digits10);
  }
  const [manualRecent, autoToday, streakMap] = await Promise.all([
    recentManualAccessSend(digits, now),
    autoSentPhonesToday(now),
    import("./installmentReminderStreak").then((m) =>
      m.listReminderStreaksByEnrollmentIds(risk.map((e) => e.id)),
    ),
  ]);

  const candidates: AutoCandidate[] = [];
  let seatBookingOnly = 0;
  const phoneClaimed = new Set<string>();

  for (const e of risk) {
    const preview = buildAccessReminderFor(e, ctx.ctx);
    const n = normalizeIndianMobile(e.phone || "");
    const digits10 = n.digits10 || "";

    const base: AutoCandidate = {
      enrollmentId: e.id,
      studentName: e.student_name,
      maskedPhone: maskMobile(e.phone),
      accessStatus: preview.accessStatus,
      templateId: preview.templateId,
      installmentNo: preview.installmentNo,
      daysLeft: preview.daysLeft,
      body: preview.body,
      skipReason: null,
      preview: preview.sendable ? preview : null,
    };

    if (preview.blockReason === "seat_booking_only") {
      seatBookingOnly++;
      candidates.push({ ...base, skipReason: "preview_blocked" });
      continue;
    }
    if (!preview.sendable || !preview.installmentKey) {
      candidates.push({ ...base, skipReason: "preview_blocked" });
      continue;
    }

    const cap = capMap.get(capKey(e.id, preview.installmentNo!));
    if (cap?.excluded_from_automation) {
      candidates.push({ ...base, skipReason: "excluded" });
      continue;
    }
    // needs_call on any installment (incl. enrollment-level 0 for payment failures) suppresses auto SMS.
    if (needsCallByEnrollment.has(e.id) || cap?.needs_call || (cap?.auto_sequences_used ?? 0) >= ACCESS_AUTO_CAP_PER_INSTALLMENT) {
      candidates.push({ ...base, skipReason: "cap_reached" });
      continue;
    }
    if (recentTransfers.has(e.id)) {
      candidates.push({ ...base, skipReason: "recent_transfer" });
      continue;
    }
    if (digits10 && manualRecent.has(digits10)) {
      candidates.push({ ...base, skipReason: "manual_recent" });
      continue;
    }
    if (digits10 && (autoToday.has(digits10) || phoneClaimed.has(digits10))) {
      candidates.push({ ...base, skipReason: "phone_day_dedupe" });
      continue;
    }

    // §5 Taper cadence — fire only on TAPER_DAY_OFFSETS matching today IST vs due date.
    const dueDate = preview.dueDate;
    if (!dueDate) {
      candidates.push({ ...base, skipReason: "not_cadence_day" });
      continue;
    }

    const streak = streakMap.get(capKey(e.id, preview.installmentNo!));
    if (streak?.paused) {
      candidates.push({ ...base, skipReason: "streak_paused" });
      continue;
    }
    if ((streak?.consecutiveDays ?? 0) >= TAPER_HARD_CAP) {
      candidates.push({ ...base, skipReason: "cap_reached" });
      continue;
    }

    const override = ctx.ctx.overridesByPhoneCourse.get(`${e.phone}::${e.course_id}`);
    const grant = activeAccessGrant(override, now);
    if (!isTaperSendDay({ dueDateIso: dueDate, grant, now })) {
      candidates.push({ ...base, skipReason: "not_cadence_day" });
      continue;
    }

    // Dry-run must still show who WOULD send once the window opens — quiet hours
    // only block live sends, not the report.
    if (quiet && !settings.dryRun) {
      candidates.push({ ...base, skipReason: "quiet_hours" });
      continue;
    }

    if (digits10) phoneClaimed.add(digits10);
    candidates.push(base);
  }

  const eligible = candidates.filter((c) => !c.skipReason);
  const ramp = settings.rampLimit || ACCESS_RAMP_FIRST_RUN;
  const ceiling = settings.dailyCeiling || ACCESS_DAILY_VOLUME_CEILING;
  // Manual bulk + prior auto sends today consume the same daily ceiling.
  const { countAccessSmsSentToday } = await import("./accessBulkGuards");
  const sentToday = await countAccessSmsSentToday(now);
  const remainingCeiling = Math.max(0, ceiling - sentToday);
  const cap = Math.min(ramp, remainingCeiling);

  let haltedReason: string | null = null;
  let wouldSend = eligible;

  if (remainingCeiling === 0 && eligible.length > 0) {
    haltedReason = "daily_ceiling";
    wouldSend = [];
    for (const c of eligible) c.skipReason = "daily_ceiling";
  } else if (eligible.length > cap) {
    wouldSend = eligible.slice(0, cap);
    for (let i = cap; i < eligible.length; i++) {
      eligible[i]!.skipReason = i >= remainingCeiling ? "daily_ceiling" : "ramp_limit";
    }
  }

  const reasonCounts = new Map<string, number>();
  for (const c of candidates) {
    if (!c.skipReason) continue;
    reasonCounts.set(c.skipReason, (reasonCounts.get(c.skipReason) || 0) + 1);
  }
  if (seatBookingOnly) reasonCounts.set("seat_booking_only", seatBookingOnly);

  return {
    settings,
    now: new Date(now).toISOString(),
    istHour: istHour(now),
    inQuietHours: quiet,
    candidates,
    wouldSend,
    excluded: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })),
    seatBookingOnly,
    haltedReason,
    sent: 0,
    dryRun: settings.dryRun,
  };
}

/**
 * Execute one automation tick. When dryRun (default), logs the plan and sends
 * nothing. When live: send step-1, schedule +30m, bump cap.
 */
export async function runAccessAutomation(now = Date.now()): Promise<AutoRunReport> {
  const plan = await planAccessAutomation(now);
  const detail = {
    wouldSend: plan.wouldSend.map((c) => ({
      enrollmentId: c.enrollmentId,
      maskedPhone: c.maskedPhone,
      studentName: c.studentName,
      accessStatus: c.accessStatus,
      templateId: c.templateId,
      installmentNo: c.installmentNo,
      daysLeft: c.daysLeft,
      body: c.body,
    })),
    excluded: plan.excluded,
    seatBookingOnly: plan.seatBookingOnly,
  };

  if (plan.settings.dryRun || !plan.settings.enabled || plan.settings.killSwitch || plan.haltedReason) {
    await logAutomationRun({
      dryRun: true,
      killSwitch: plan.settings.killSwitch,
      enabled: plan.settings.enabled,
      wouldSend: plan.wouldSend.length,
      excluded: plan.candidates.length - plan.wouldSend.length,
      sent: 0,
      haltedReason: plan.haltedReason || (plan.settings.killSwitch ? "kill_switch" : !plan.settings.enabled ? "disabled" : plan.settings.dryRun ? "dry_run" : null),
      detail,
    });
    return { ...plan, dryRun: true, sent: 0 };
  }

  let sent = 0;
  // Hard cap: never more than 5 concurrent DB/SMS ops in one tick (sequential loop
  // already serializes; circuit check aborts mid-run on pool pressure).
  for (const c of plan.wouldSend) {
    if (dbCircuitOpen() || heavyCronHalted()) break;
    if (!c.preview?.installmentKey || !c.preview.templateId) continue;
    const e = await getCourseEnrollmentById(c.enrollmentId);
    if (!e) continue;

    const variables = Object.fromEntries(c.preview.variables.map((v) => [v.token, v.value]));
    const today = istYMD(new Date(now))!;
    const taperKey = c.preview.dueDate
      ? `taper:${e.id}:${c.preview.installmentKey.installmentNo}:${today}:${c.preview.templateId}`
      : undefined;
    const result = await sendSms({
      mobile: e.phone,
      templateId: c.preview.templateId,
      variables,
      relatedEntity: {
        student_name: e.student_name,
        course_id: e.course_id,
        user_id: e.student_id ?? null,
      },
      sentBy: { userId: null, type: "SYSTEM" },
      triggerEvent: "automated_access_reminder",
      audienceType: "access_risk",
      installmentKey: c.preview.installmentKey,
      enforceWindow: true,
      dedupeKey: taperKey,
    });
    if (!result.ok || !result.logId) continue;

    const digits = normalizeIndianMobile(e.phone).digits10;
    // Drop +30m installment_instructions when primary is installment_reminder.
    if (digits && c.preview.templateId !== ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID) {
      await scheduleFollowUp({
        parentSendId: result.logId,
        normalizedMobile: digits,
        courseEnrollmentId: c.preview.installmentKey.courseEnrollmentId,
        installmentNo: c.preview.installmentKey.installmentNo,
        installmentFingerprint: c.preview.installmentKey.fingerprint,
        studentName: e.student_name,
        studentId: e.student_id ?? null,
        courseId: e.course_id,
        actorUserId: null,
      });
    }

    try {
      const { appendStudentAccessEvent } = await import("../studentAccessEvents");
      const { recordReminderStreakSend, markStreakCallTaskCreated, getReminderStreak } = await import("./installmentReminderStreak");
      const dueDate = c.preview.dueDate;
      await appendStudentAccessEvent({
        studentId: e.student_id ?? null,
        phone: e.phone,
        courseId: e.course_id,
        courseEnrollmentId: c.enrollmentId,
        eventType: "reminder_sent",
        actor: "system",
        channel: "sms",
        templateId: c.preview.templateId,
        bodySent: c.preview.body,
        installmentNo: c.preview.installmentKey.installmentNo,
        relatedEventId: result.logId,
        meta: { trigger: "installment_access_reminder", taper: true },
      });
      const streak = await recordReminderStreakSend({
        enrollmentId: c.enrollmentId,
        installmentNo: c.preview.installmentKey.installmentNo,
      });
      const callTaskDay = dueDate ? isTaperCallTaskDay(dueDate, now) : false;
      if (streak.hitCap || callTaskDay) {
        const prev = await getReminderStreak(c.enrollmentId, c.preview.installmentKey.installmentNo);
        if (!prev?.callTaskCreated) {
          const { createCollectionsCallTask } = await import("../accessActions");
          await createCollectionsCallTask({
            enrollmentId: c.enrollmentId,
            actor: { id: null, name: "system" },
            reason: streak.hitCap ? "reminder_streak_cap_10" : "taper_p10_call",
            installmentNo: c.preview.installmentKey.installmentNo,
          });
          await markStreakCallTaskCreated(c.enrollmentId, c.preview.installmentKey.installmentNo);
        }
      }
    } catch { /* non-fatal */ }

    await recordAutoSequence({
      courseEnrollmentId: c.preview.installmentKey.courseEnrollmentId,
      installmentNo: c.preview.installmentKey.installmentNo,
      fingerprint: c.preview.installmentKey.fingerprint,
      studentId: e.student_id ?? null,
      normalizedMobile: digits ?? null,
    });
    sent++;
  }

  await logAutomationRun({
    dryRun: false,
    killSwitch: plan.settings.killSwitch,
    enabled: plan.settings.enabled,
    wouldSend: plan.wouldSend.length,
    excluded: plan.candidates.length - plan.wouldSend.length,
    sent,
    haltedReason: null,
    detail,
  });

  return { ...plan, dryRun: false, sent };
}

/** Console-friendly summary for QA / cron logs (no per-recipient tables). */
export function printAutoReport(report: AutoRunReport): void {
  console.log("[access-automation]", {
    dryRun: report.dryRun,
    enabled: report.settings.enabled,
    killSwitch: report.settings.killSwitch,
    istHour: report.istHour,
    quiet: report.inQuietHours,
    wouldSend: report.wouldSend.length,
    sent: report.sent,
    excluded: report.excluded.length,
    halted: report.haltedReason,
    seatBookingOnly: report.seatBookingOnly,
  });
}
