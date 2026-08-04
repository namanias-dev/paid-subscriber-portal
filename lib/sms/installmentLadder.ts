/**
 * Instalment follow-up ladder (−7d / −3d / due / +3d / +7d call).
 *
 * SEPARATE from ACCESS_AUTO_CAP_PER_INSTALLMENT (access blocked/expiring SMS).
 * This module never increments access_reminder_caps.auto_sequences_used.
 *
 * Cron may plan and dry-run; real sends require explicit approval + settings.
 */
import type { CourseEnrollment } from "../types";
import { nextUnpaidDatedLine, daysOverdueFromSchedule } from "../accessAtRisk";
import { lectureAccessForCourse, type LectureAccess } from "../entitlements";
import type { Course } from "../types";

export const LADDER_STEPS = ["m7", "m3", "d0", "p3", "p7_call"] as const;
export type LadderStep = (typeof LADDER_STEPS)[number];

export const LADDER_STEP_OFFSET_DAYS: Record<LadderStep, number> = {
  m7: -7,
  m3: -3,
  d0: 0,
  p3: 3,
  p7_call: 7,
};

export const LADDER_CAP = 5;

/** Which step is "current" for an unpaid line given days relative to due (negative = before). */
export function currentLadderStep(daysFromDue: number): LadderStep | null {
  if (daysFromDue >= 7) return "p7_call";
  if (daysFromDue >= 3) return "p3";
  if (daysFromDue >= 0) return "d0";
  if (daysFromDue >= -3) return "m3";
  if (daysFromDue >= -7) return "m7";
  return null; // more than 7 days before due — not yet on ladder
}

export function daysFromDue(dueISO: string, now = Date.now()): number {
  const due = Date.parse(dueISO);
  if (!Number.isFinite(due)) return NaN;
  return Math.floor((now - due) / 86_400_000);
}

export type LadderDryCandidate = {
  enrollmentId: string;
  studentName: string;
  phone: string;
  loginCode: string | null;
  courseTitle: string;
  pctPaid: number;
  amountDue: number;
  daysOverdue: number;
  daysFromDue: number;
  installmentNo: number;
  dueDate: string;
  liveAccess: string;
  liveAllowed: boolean;
  bucket:
    | "recent_overdue_sms"
    | "long_dormant_call_only"
    | "under_25_flag"
    | "exclude_review"
    | "upcoming_ladder"
    | "skip_not_live_risk";
  proposedChannel: "sms" | "call_task" | "none";
  proposedStep: LadderStep | "backfill_one" | "backfill_call";
  proposedMessage: string;
  lastContactAt: string | null;
  excludeReason: string | null;
};

export function buildLadderMessage(input: {
  firstName: string;
  amountDue: number;
  dueLabel: string;
  step: LadderStep | "backfill_one";
}): string {
  const amt = `₹${Math.round(input.amountDue).toLocaleString("en-IN")}`;
  switch (input.step) {
    case "m7":
      return `Hi ${input.firstName}, reminder: installment of ${amt} is due on ${input.dueLabel}. Pay on time to keep uninterrupted access. Naman Sharma IAS Academy.`;
    case "m3":
      return `Hi ${input.firstName}, your installment of ${amt} is due in 3 days (${input.dueLabel}). Please pay to avoid access interruption. Naman Sharma IAS Academy.`;
    case "d0":
      return `Hi ${input.firstName}, your installment of ${amt} is due today (${input.dueLabel}). Pay now to stay on track. Naman Sharma IAS Academy.`;
    case "p3":
      return `Hi ${input.firstName}, your installment of ${amt} was due on ${input.dueLabel} and is overdue. Please pay to restore/keep access. Naman Sharma IAS Academy.`;
    case "backfill_one":
      return `Hi ${input.firstName}, your installment of ${amt} (due ${input.dueLabel}) is outstanding. Please complete payment at your earliest. Naman Sharma IAS Academy.`;
    default:
      return `Hi ${input.firstName}, your installment of ${amt} needs attention (due ${input.dueLabel}). Naman Sharma IAS Academy.`;
  }
}

export function firstNameFrom(full: string): string {
  const t = (full || "").trim().split(/\s+/)[0];
  return t || "Student";
}

/**
 * Backfill bucket for currently-overdue students (do not replay full ladder).
 * Only live schedule risk (blocked/grace) is SMS-eligible for Stage 2 backlog.
 */
export function classifyBackfillBucket(input: {
  daysOverdue: number;
  pctPaid: number;
  liveAccess: LectureAccess;
  excludeReason: string | null;
  lastContactAt: string | null;
}): LadderDryCandidate["bucket"] {
  if (input.excludeReason) return "exclude_review";
  if (!isScheduleRisk(input.liveAccess)) return "skip_not_live_risk";
  if (input.pctPaid < 25) return "under_25_flag";
  if (input.daysOverdue > 60 && !input.lastContactAt) return "long_dormant_call_only";
  if (input.daysOverdue <= 30) return "recent_overdue_sms";
  // 31–60d overdue: treat as recent-ish one reminder (still first contact policy)
  if (input.daysOverdue <= 60) return "recent_overdue_sms";
  return "long_dormant_call_only";
}

function isScheduleRisk(a: LectureAccess): boolean {
  if (a.status === "grace") return true;
  if (a.status === "blocked" && a.reason === "overdue") return true;
  return false;
}

export function evaluateEnrollmentForBackfill(input: {
  enrollment: CourseEnrollment;
  course: Course | undefined;
  loginCode: string | null;
  lastContactAt: string | null;
  excludeReason: string | null;
  now?: number;
}): LadderDryCandidate | null {
  const now = input.now ?? Date.now();
  const e = input.enrollment;
  const line = nextUnpaidDatedLine(e.schedule);
  if (!line?.due) return null;
  const dfd = daysFromDue(line.due, now);
  if (!(dfd >= 0)) return null; // not yet overdue — forward ladder handles later
  const live = lectureAccessForCourse(input.course, e, undefined, false, now);
  const pct = e.total_fee > 0 ? Math.round((100 * (e.amount_paid || 0)) / e.total_fee) : 0;
  const daysOverdue = daysOverdueFromSchedule(e, now);
  const bucket = classifyBackfillBucket({
    daysOverdue,
    pctPaid: pct,
    liveAccess: live,
    excludeReason: input.excludeReason,
    lastContactAt: input.lastContactAt,
  });
  const dueLabel = line.due.slice(0, 10);
  const first = firstNameFrom(e.student_name);
  let proposedChannel: LadderDryCandidate["proposedChannel"] = "none";
  let proposedStep: LadderDryCandidate["proposedStep"] = "backfill_one";
  let proposedMessage = "";

  if (bucket === "exclude_review" || bucket === "skip_not_live_risk") {
    proposedChannel = "none";
    proposedMessage = "(no send — excluded or lectures not in live blocked/grace)";
  } else if (bucket === "long_dormant_call_only" || bucket === "under_25_flag") {
    // under_25: flag for different conversation — call task, no cold SMS in backlog
    proposedChannel = "call_task";
    proposedStep = "backfill_call";
    proposedMessage = `(call task only) Follow up ${e.student_name}: ${line.label} ${line.amount} overdue ${daysOverdue}d · ${pct}% paid`;
  } else if (bucket === "recent_overdue_sms") {
    proposedChannel = "sms";
    proposedStep = "backfill_one";
    proposedMessage = buildLadderMessage({
      firstName: first,
      amountDue: line.amount || 0,
      dueLabel,
      step: "backfill_one",
    });
  }

  return {
    enrollmentId: e.id,
    studentName: e.student_name,
    phone: e.phone,
    loginCode: input.loginCode,
    courseTitle: e.course_title || input.course?.title || "Course",
    pctPaid: pct,
    amountDue: line.amount || 0,
    daysOverdue,
    daysFromDue: dfd,
    installmentNo: line.no,
    dueDate: dueLabel,
    liveAccess: `${live.status}/${live.reason}`,
    liveAllowed: live.allowed,
    bucket,
    proposedChannel,
    proposedStep,
    proposedMessage,
    lastContactAt: input.lastContactAt,
    excludeReason: input.excludeReason,
  };
}
