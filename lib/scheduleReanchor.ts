/**
 * Preview / apply due-date re-anchoring so installment 1 never falls before
 * batch start. PREVIEW IS THE DEFAULT — apply is behind an explicit admin
 * confirmation and is unused at ship.
 */
import { addMonthsISO } from "./dates";
import { isTrustedBatchStartForReanchor, resolveEnrollmentBatchStart } from "./batchStart";
import {
  BATCH_START_INSTALLMENT_OFFSET_DAYS,
  firstInstallmentDueISO,
  isActiveEnrollment,
} from "./installments";
import { lectureAccessForCourse } from "./entitlements";
import type { Course, CourseEnrollment, InstallmentItem } from "./types";

export interface ReanchorLinePreview {
  no: number;
  kind: string;
  label: string;
  paid: boolean;
  currentDue: string | null;
  proposedDue: string | null;
  daysShifted: number | null;
}

export interface ReanchorEnrollmentPreview {
  enrollmentId: string;
  studentName: string;
  phone: string;
  courseTitle: string;
  batchLabel: string | null;
  batchStart: string | null;
  batchProvenance: string;
  bookedAt: string;
  lines: ReanchorLinePreview[];
  accessBefore: string;
  accessAfter: string;
  wouldChange: boolean;
  rupeesMovingOutOfMonth: number;
  skipReason: string | null;
}

function istMonthKey(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(d);
}

/** Pure preview for one enrollment. Never mutates. */
export function previewReanchorEnrollment(
  enrollment: CourseEnrollment,
  course: Course | undefined,
  now = Date.now(),
): ReanchorEnrollmentPreview {
  const batch = resolveEnrollmentBatchStart(course, enrollment);
  const bookingISO = enrollment.created_at;
  const accessBefore = lectureAccessForCourse(course, enrollment, undefined, false, now);

  const base: Omit<ReanchorEnrollmentPreview, "lines" | "accessAfter" | "wouldChange" | "rupeesMovingOutOfMonth" | "skipReason"> & {
    lines: ReanchorLinePreview[];
    accessAfter: string;
    wouldChange: boolean;
    rupeesMovingOutOfMonth: number;
    skipReason: string | null;
  } = {
    enrollmentId: enrollment.id,
    studentName: enrollment.student_name,
    phone: enrollment.phone,
    courseTitle: enrollment.course_title || course?.title || "Course",
    batchLabel: enrollment.batch_label,
    batchStart: batch.iso,
    batchProvenance: batch.provenance,
    bookedAt: bookingISO,
    accessBefore: accessBefore.status,
    lines: [],
    accessAfter: accessBefore.status,
    wouldChange: false,
    rupeesMovingOutOfMonth: 0,
    skipReason: null,
  };

  if (!isActiveEnrollment(enrollment)) {
    return { ...base, skipReason: "not_active_enrollment" };
  }
  if (!batch.iso) {
    return { ...base, skipReason: "batch_start_unknown" };
  }
  // Only catalog / earliest-class — never re-anchor off a free-text label parse.
  if (!isTrustedBatchStartForReanchor(batch.provenance)) {
    return { ...base, skipReason: "batch_start_untrusted" };
  }

  const schedule = enrollment.schedule || [];
  const unpaidInstallments = schedule.filter(
    (s) => s.kind === "installment" && !s.paid && s.status !== "cancelled" && s.status !== "waived",
  );
  if (!unpaidInstallments.length) {
    return { ...base, skipReason: "no_unpaid_installments" };
  }

  // Reconstruct first due from booking + course first_interval, then MAX with batch start.
  const firstIntervalDays = course?.emi_config?.first_interval_days != null
    ? Math.max(0, Math.round(Number(course.emi_config.first_interval_days)))
    : 7;
  const intervalMonths = course?.emi_config?.interval_months != null
    ? Math.max(1, Math.round(Number(course.emi_config.interval_months)))
    : 1;
  const proposedFirst = firstInstallmentDueISO(bookingISO, firstIntervalDays, batch.iso);

  // Map unpaid installment numbers to proposed dues relative to their position.
  const installmentNos = schedule
    .filter((s) => s.kind === "installment")
    .map((s) => s.no)
    .sort((a, b) => a - b);
  const firstNo = installmentNos[0] ?? 1;

  const proposedByNo = new Map<number, string>();
  for (const no of installmentNos) {
    const offset = Math.max(0, no - firstNo);
    proposedByNo.set(no, offset === 0 ? proposedFirst : addMonthsISO(proposedFirst, offset * intervalMonths));
  }

  const thisMonth = istMonthKey(new Date(now).toISOString());
  let rupeesMovingOutOfMonth = 0;
  let wouldChange = false;
  const lines: ReanchorLinePreview[] = schedule.map((s) => {
    if (s.kind !== "installment" || s.paid || s.status === "cancelled" || s.status === "waived") {
      return {
        no: s.no, kind: s.kind, label: s.label, paid: !!s.paid,
        currentDue: s.due, proposedDue: s.due, daysShifted: 0,
      };
    }
    const proposed = proposedByNo.get(s.no) ?? s.due;
    const curMs = s.due ? Date.parse(s.due) : NaN;
    const propMs = proposed ? Date.parse(proposed) : NaN;
    const daysShifted = Number.isFinite(curMs) && Number.isFinite(propMs)
      ? Math.round((propMs - curMs) / 86_400_000)
      : null;
    if (daysShifted && daysShifted !== 0) wouldChange = true;
    if (
      daysShifted && daysShifted > 0
      && thisMonth && istMonthKey(s.due) === thisMonth
      && istMonthKey(proposed) !== thisMonth
    ) {
      rupeesMovingOutOfMonth += s.amount || 0;
    }
    return {
      no: s.no, kind: s.kind, label: s.label, paid: !!s.paid,
      currentDue: s.due, proposedDue: proposed ?? null, daysShifted,
    };
  });

  // Simulate access after date shift (amounts unchanged).
  const simulated: CourseEnrollment = {
    ...enrollment,
    schedule: schedule.map((s) => {
      if (s.kind !== "installment" || s.paid || s.status === "cancelled" || s.status === "waived") return s;
      const proposed = proposedByNo.get(s.no);
      return proposed ? { ...s, due: proposed } : s;
    }),
  };
  const accessAfter = lectureAccessForCourse(course, simulated, undefined, false, now);

  // Only report as a candidate when any unpaid due is currently before batch start.
  const hasPreBatch = schedule.some((s) => {
    if (s.kind !== "installment" || s.paid || !s.due || !batch.iso) return false;
    return Date.parse(s.due) < Date.parse(batch.iso);
  });
  if (!hasPreBatch) {
    return {
      ...base, lines, accessAfter: accessAfter.status, wouldChange: false,
      rupeesMovingOutOfMonth: 0, skipReason: "no_pre_batch_dues",
    };
  }

  return {
    ...base,
    lines,
    accessAfter: accessAfter.status,
    wouldChange,
    rupeesMovingOutOfMonth,
    skipReason: null,
  };
}

/** Apply proposed dues to a schedule copy. Paid lines untouched. Pure. */
export function applyReanchorToSchedule(
  schedule: InstallmentItem[],
  proposedByNo: Map<number, string>,
): InstallmentItem[] {
  return schedule.map((s) => {
    if (s.kind !== "installment" || s.paid || s.status === "cancelled" || s.status === "waived") return s;
    const proposed = proposedByNo.get(s.no);
    return proposed ? { ...s, due: proposed } : s;
  });
}

/** Build the proposed-by-no map from a preview (for apply / revert helpers). */
export function proposedDueMapFromPreview(preview: ReanchorEnrollmentPreview): Map<number, string> {
  const m = new Map<number, string>();
  for (const line of preview.lines) {
    if (line.proposedDue && line.kind === "installment" && !line.paid) {
      m.set(line.no, line.proposedDue);
    }
  }
  return m;
}

/** Apply preview dues onto a schedule. Amounts/paid flags untouched. */
export function scheduleFromReanchorPreview(
  schedule: InstallmentItem[],
  preview: ReanchorEnrollmentPreview,
): InstallmentItem[] {
  return applyReanchorToSchedule(schedule, proposedDueMapFromPreview(preview));
}

/** Offset helper for tests / callers that already have batch start. */
export function batchAnchoredFirstDue(bookingISO: string, firstIntervalDays: number, batchStartISO: string): string {
  return firstInstallmentDueISO(bookingISO, firstIntervalDays, batchStartISO, BATCH_START_INSTALLMENT_OFFSET_DAYS);
}
