/**
 * SIMULATED Access At Risk bulk selection for the blocked cohort.
 * ZERO sends — preview + guards only.
 */
import { getAllCourseEnrollments, getAllAccessOverrides, getAllCourses } from "../../lib/dataProvider";
import { lectureAccessForCourse } from "../../lib/entitlements";
import { isAccessAtRiskEnrollment } from "../../lib/accessAtRisk";
import { isActiveEnrollment } from "../../lib/installments";
import { buildBulkAccessReminders, activeAccessGrant } from "../../lib/sms/accessReminderService";
import { listCapsForEnrollments, getAccessReminderSettings } from "../../lib/sms/accessCapStore";
import {
  remainingAccessDailyBudget,
  templateBreakdown,
  enrollmentNeedsCallSet,
  accessPhonesSentToday,
} from "../../lib/sms/accessBulkGuards";
import { maskMobile, normalizeIndianMobile } from "../../lib/phone";
import {
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
} from "../../lib/sms/accessReminderConstants";

function maskName(name: string | null | undefined): string {
  const n = (name || "?").trim().split(/\s+/);
  if (n.length === 1) return n[0].slice(0, 2) + "***";
  return n[0] + " " + n[n.length - 1].slice(0, 1) + ".";
}

async function main() {
  const now = Date.now();
  const [enrollments, courses, overrides, settings, budget] = await Promise.all([
    getAllCourseEnrollments(),
    getAllCourses(),
    getAllAccessOverrides(),
    getAccessReminderSettings(),
    remainingAccessDailyBudget(now),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));

  const risk = enrollments.filter((e) => {
    if (!isActiveEnrollment(e) || e.status === "cancelled" || e.status === "transferred_out") return false;
    const ovr = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    const schedule = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    return isAccessAtRiskEnrollment({ enrollment: e, scheduleAccess: schedule, override: ovr, now });
  });

  const state = { blocked: 0, grace: 0, grantHolding: 0, needsCall: 0, list: risk.length };
  const caps = await listCapsForEnrollments(risk.map((e) => e.id));
  const needsCall = new Set(caps.filter((c) => c.needs_call).map((c) => c.course_enrollment_id));
  for (const e of risk) {
    const ovr = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    const schedule = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    if (schedule.status === "blocked") state.blocked++;
    if (schedule.status === "grace") state.grace++;
    if (activeAccessGrant(ovr, now)) state.grantHolding++;
    if (needsCall.has(e.id)) state.needsCall++;
  }

  console.log("=== Access At Risk list (per-state) ===");
  console.table([state]);
  console.log("=== Automation settings (must be unchanged) ===");
  console.table([{
    enabled: settings.enabled,
    dry_run: settings.dryRun,
    kill_switch: settings.killSwitch,
    ramp: settings.rampLimit,
    ceiling: settings.dailyCeiling,
    quiet: budget.quiet,
    sentToday: budget.sentToday,
    remaining: budget.remaining,
  }]);

  const blockedCohort = risk.filter((e) => {
    const schedule = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    return schedule.status === "blocked";
  });
  const actionable = blockedCohort.filter((e) => !needsCall.has(e.id));
  console.log(`Blocked cohort: ${blockedCohort.length} · actionable (not needs_call): ${actionable.length}`);

  const preview = await buildBulkAccessReminders(actionable.map((e) => e.id), { now });
  const phonesToday = await accessPhonesSentToday(now);
  const needsCallSet = await enrollmentNeedsCallSet(actionable.map((e) => e.id));

  const would: {
    student: string; phone: string; template: string; days: number | null; amount: number | null; skip: string | null;
  }[] = [];
  let wouldSend = 0;
  for (const p of preview.previews) {
    let skip: string | null = null;
    if (!p.sendable) skip = p.blockReason || "not_sendable";
    else if (budget.killSwitch) skip = "kill_switch";
    else if (budget.quiet) skip = "quiet_hours";
    else if (needsCallSet.has(p.enrollmentId)) skip = "needs_call";
    else {
      const e = actionable.find((x) => x.id === p.enrollmentId);
      const digits = e ? normalizeIndianMobile(e.phone).digits10 : null;
      if (digits && phonesToday.has(digits)) skip = "already_sent_today";
    }
    if (!skip && wouldSend >= budget.remaining) skip = "daily_ceiling";
    if (!skip) wouldSend++;
    would.push({
      student: maskName(p.studentName),
      phone: p.maskedPhone || maskMobile(""),
      template: p.templateId === ACCESS_EXPIRING_TEMPLATE_ID ? "expiring"
        : p.templateId === ACCESS_BLOCKED_TEMPLATE_ID ? "blocked" : (p.templateId || "—"),
      days: p.daysLeft,
      amount: p.amountDue,
      skip,
    });
  }

  const sendable = would.filter((w) => !w.skip);
  console.log("\n=== SIMULATED bulk (blocked cohort) — ZERO SENDS ===");
  console.table(sendable.slice(0, 40));
  const skips: Record<string, number> = {};
  for (const w of would) if (w.skip) skips[w.skip] = (skips[w.skip] || 0) + 1;
  console.log("Skip reasons:", skips);
  console.log("Template breakdown (would-send):", templateBreakdown(
    preview.previews.filter((p) => sendable.some((s) => s.phone === p.maskedPhone && !s.skip)),
  ));
  console.log({
    selected: actionable.length,
    wouldSend: sendable.length,
    skipped: would.length - sendable.length,
    ZERO_OUTBOUND: true,
  });
  console.log("KILL SWITCH: update access_reminder_settings set kill_switch=true, enabled=false, dry_run=true where id=1;");
}

main().catch((e) => { console.error(e); process.exit(1); });
