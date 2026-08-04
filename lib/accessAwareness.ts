/**
 * Stage 4 — student-facing access awareness. Reads lectureAccessForCourse only;
 * does not change payment or entitlement rules.
 * Server-only builders — client UI imports types from accessAwarenessTypes.ts.
 */
import { lectureAccessForCourse, type LectureAccess } from "./entitlements";
import { isScheduleCollectionsRisk, nextUnpaidDatedLine } from "./accessAtRisk";
import { activeAccessGrant } from "./sms/accessReminderService";
import { istWholeDaysUntil } from "./sms/accessDays";
import type { Course, CourseEnrollment, CourseAccessOverride } from "./types";
import {
  type AccessAwarenessBanner,
  type AccessAwarenessVariant,
  formatAwarenessDate,
} from "./accessAwarenessTypes";

export type { AccessAwarenessBanner, AccessAwarenessVariant };
export { formatAwarenessDate };

function scheduleVariant(schedule: LectureAccess): AccessAwarenessVariant | null {
  if (schedule.status === "grace") return "grace";
  if (schedule.status === "blocked" && schedule.reason === "overdue") return "blocked";
  return null;
}

/**
 * Build banner props for one enrollment when schedule access is degraded (grace / overdue-blocked).
 * Returns null when access is fine or not an installment collections case.
 */
export function accessAwarenessForEnrollment(
  course: Course | undefined,
  enrollment: CourseEnrollment,
  override: CourseAccessOverride | undefined,
  now = Date.now(),
): AccessAwarenessBanner | null {
  const schedule = lectureAccessForCourse(course, enrollment, undefined, false, now);
  const variant = scheduleVariant(schedule);
  if (!variant || !isScheduleCollectionsRisk(schedule)) return null;

  const live = lectureAccessForCourse(course, enrollment, override, false, now);
  const grant = activeAccessGrant(override, now);
  const unpaid = nextUnpaidDatedLine(enrollment.schedule);
  const amountDue = schedule.amountDue ?? unpaid?.amount ?? Math.max(0, (enrollment.total_fee || 0) - (enrollment.amount_paid || 0));

  return {
    variant,
    courseId: enrollment.course_id,
    courseTitle: enrollment.course_title || course?.title || "Course",
    enrollmentId: enrollment.id,
    amountDue,
    installmentNo: unpaid?.no ?? null,
    installmentLabel: unpaid?.label ?? null,
    payHref: `/portal/course/${enrollment.id}`,
    graceEndsAt: schedule.graceEndsAt ?? null,
    graceDaysLeft: schedule.daysLeft ?? (schedule.graceEndsAt ? istWholeDaysUntil(schedule.graceEndsAt, now) : null),
    extensionExpiresAt: grant?.expires_at ?? null,
    extensionDaysLeft: grant?.expires_at ? istWholeDaysUntil(grant.expires_at, now) : null,
    liveAccessAllowed: live.allowed,
    scheduleStatus: schedule.status,
  };
}

/** Pick the most urgent banner when several enrollments are at risk (blocked beats grace). */
export function pickPrimaryAccessAwareness(banners: AccessAwarenessBanner[]): AccessAwarenessBanner | null {
  if (!banners.length) return null;
  const rank = (v: AccessAwarenessVariant) => (v === "blocked" ? 0 : 1);
  return banners.slice().sort((a, b) => {
    const d = rank(a.variant) - rank(b.variant);
    if (d !== 0) return d;
    return b.amountDue - a.amountDue;
  })[0];
}
