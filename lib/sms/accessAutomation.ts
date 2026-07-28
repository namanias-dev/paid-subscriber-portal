/**
 * Access At Risk AUTOMATION runner.
 *
 * Ship defaults: killSwitch OFF, dryRun ON, enabled FALSE — so a cron tick
 * only LOGS what would send. Real sends require an explicit settings flip.
 *
 * Cadence / caps / quiet hours live in accessReminderConstants.ts.
 */
import {
  getAllCourseEnrollments, getAllCourses, getAllAccessOverrides, getCourseEnrollmentById, pageThrough,
} from "../dataProvider";
import { lectureAccessForCourse } from "../entitlements";
import { maskMobile, normalizeIndianMobile } from "../phone";
import { istYMD } from "../dates";
import { getSupabaseAdmin } from "../supabase";
import { listLogs } from "./store";
import { sendSms } from "./service";
import { scheduleFollowUp } from "./installmentFollowUp";
import {
  buildAccessReminderContext,
  buildAccessReminderFor,
  type AccessReminderPreview,
} from "./accessReminderService";
import { istHour, istWeekday } from "./accessDays";
import {
  ACCESS_AUTO_CAP_PER_INSTALLMENT,
  ACCESS_BLOCKED_REPEAT_DAYS,
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_DAILY_VOLUME_CEILING,
  ACCESS_EXPIRING_TEMPLATE_ID,
  ACCESS_GRACE_WEEKDAYS_IST,
  ACCESS_MANUAL_DEDUP_HOURS,
  ACCESS_MAX_AUTO_PER_PHONE_PER_DAY,
  ACCESS_POST_TRANSFER_SKIP_HOURS,
  ACCESS_QUIET_HOURS_IST,
  ACCESS_RAMP_FIRST_RUN,
} from "./accessReminderConstants";
import {
  getAccessReminderSettings,
  listCapsForEnrollments,
  logAutomationRun,
  recordAutoSequence,
  type AccessCapRow,
  type AccessReminderSettings,
} from "./accessCapStore";

export type AutoSkipReason =
  | "kill_switch"
  | "disabled"
  | "quiet_hours"
  | "not_cadence_day"
  | "blocked_too_soon"
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

function isGraceCadenceDay(now: number): boolean {
  const wd = istWeekday(now);
  return (ACCESS_GRACE_WEEKDAYS_IST as readonly number[]).includes(wd);
}

function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

async function recentManualAccessSend(digits: Set<string>, now: number): Promise<Set<string>> {
  const since = new Date(now - ACCESS_MANUAL_DEDUP_HOURS * 3600_000).toISOString();
  const [a, b] = await Promise.all([
    listLogs({ from: since, templateId: ACCESS_BLOCKED_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_EXPIRING_TEMPLATE_ID, limit: 5000 }),
  ]);
  const hit = new Set<string>();
  for (const l of [...a, ...b]) {
    if (!digits.has(l.normalized_mobile)) continue;
    if (l.sent_by_type === "ADMIN") hit.add(l.normalized_mobile);
  }
  return hit;
}

async function autoSentPhonesToday(now: number): Promise<Set<string>> {
  const today = istYMD(new Date(now))!;
  const since = `${today}T00:00:00+05:30`;
  const [a, b] = await Promise.all([
    listLogs({ from: since, templateId: ACCESS_BLOCKED_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_EXPIRING_TEMPLATE_ID, limit: 5000 }),
  ]);
  const hit = new Set<string>();
  for (const l of [...a, ...b]) {
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

  if (settings.killSwitch) return empty("kill_switch");
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

  // Risk follows SCHEDULE state — temporary grants must not remove someone from
  // the automation pool (they may still be sendable with the Expiring template).
  const risk = enrollments.filter((e) => {
    if (e.status === "cancelled") return false;
    const access = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    return access.status === "blocked" || access.status === "grace" || access.status === "expiring";
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
  const [manualRecent, autoToday] = await Promise.all([
    recentManualAccessSend(digits, now),
    autoSentPhonesToday(now),
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

    // Cadence
    if (preview.accessStatus === "grace") {
      if (!isGraceCadenceDay(now)) {
        candidates.push({ ...base, skipReason: "not_cadence_day" });
        continue;
      }
    } else if (preview.accessStatus === "blocked") {
      const last = cap?.last_auto_sent_at;
      const since = daysSince(last, now);
      if (last && since != null && since < ACCESS_BLOCKED_REPEAT_DAYS) {
        candidates.push({ ...base, skipReason: "blocked_too_soon" });
        continue;
      }
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

  let haltedReason: string | null = null;
  let wouldSend = eligible;

  if (eligible.length > ceiling) {
    haltedReason = "daily_ceiling";
    wouldSend = [];
    for (const c of eligible) c.skipReason = "daily_ceiling";
  } else if (eligible.length > ramp) {
    // Backlog: take ramp, mark the rest.
    wouldSend = eligible.slice(0, ramp);
    for (const c of eligible.slice(ramp)) c.skipReason = "ramp_limit";
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
  for (const c of plan.wouldSend) {
    if (!c.preview?.installmentKey || !c.preview.templateId) continue;
    const e = await getCourseEnrollmentById(c.enrollmentId);
    if (!e) continue;

    const variables = Object.fromEntries(c.preview.variables.map((v) => [v.token, v.value]));
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
    });
    if (!result.ok || !result.logId) continue;

    const digits = normalizeIndianMobile(e.phone).digits10;
    if (digits) {
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

/** Console-friendly tables for QA / cron logs. */
export function printAutoReport(report: AutoRunReport): void {
  console.log("\n=== Access automation run ===");
  console.log({
    dryRun: report.dryRun,
    enabled: report.settings.enabled,
    killSwitch: report.settings.killSwitch,
    istHour: report.istHour,
    quiet: report.inQuietHours,
    wouldSend: report.wouldSend.length,
    sent: report.sent,
    halted: report.haltedReason,
    seatBookingOnly: report.seatBookingOnly,
  });
  if (report.wouldSend.length) {
    console.table(report.wouldSend.map((c) => ({
      student: c.studentName,
      phone: c.maskedPhone,
      status: c.accessStatus,
      template: c.templateId,
      inst: c.installmentNo,
      days: c.daysLeft,
    })));
  }
  if (report.excluded.length) {
    console.table(report.excluded);
  }
}
