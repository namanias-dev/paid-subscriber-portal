/**
 * Installment-reminder variable resolution.
 *
 * SOURCE OF TRUTH — read this before changing anything here.
 * ---------------------------------------------------------
 * Installment facts come from `course_enrollments.schedule` (310 live rows) run
 * through `deriveCollections` in lib/installments — the EXACT pair the Fees &
 * EMI cards, the cohort drill-in and the Fees-at-Risk worklist already use. That
 * is deliberate: every number this file puts in an SMS is the same number a
 * staff member is looking at on those screens, by construction rather than by
 * a parallel calculation that can drift.
 *
 * It must NEVER read `getEnrollments()` / the bare `enrollments` table. That
 * table holds exactly 3 seed-fixture rows and its reader falls back to
 * lib/mockData.ts when the table is empty, so anything built on it renders
 * fabricated amounts. A reminder quoting a fabricated amount to a real student
 * is the same class of incident as the unrendered placeholder this work fixes.
 */
import { deriveCollections, isLineOutstanding } from "../installments";
import type { CourseEnrollment, InstallmentItem } from "../types";

/** Why a student cannot be sent an installment reminder. */
export type InstallmentBlockReason =
  | "no_active_enrollment"
  | "no_unpaid_installment"
  | "seat_booking_only"
  | "zero_balance"
  | "missing_phone";

export interface ResolvedInstallment {
  enrollmentId: string;
  courseTitle: string;
  /** The line the reminder refers to — the OLDEST UNPAID installment. */
  line: InstallmentItem;
  /** Installment number as printed in the SMS. */
  installmentNo: number;
  /** Outstanding rupees on that ONE line (not the whole enrollment balance). */
  amountDue: number;
  /** Whole-enrollment balance, for the staff-facing preview only. */
  totalRemaining: number;
  dueDate: string | null;
  isOverdue: boolean;
  /** Count of unpaid installment lines — drives the "oldest of N" UI note. */
  unpaidCount: number;
  /**
   * What the EMI / at-risk pages show as `nextPayable` for this enrollment.
   * Normally the same line. It differs only if the oldest outstanding line is a
   * SEAT line, which no live enrollment currently has — surfaced rather than
   * hidden so a cross-check mismatch is visible instead of silent.
   */
  pageNextPayableNo: number | null;
  matchesPageNextPayable: boolean;
}

export type InstallmentResolution =
  | { ok: true; resolved: ResolvedInstallment }
  | { ok: false; reason: InstallmentBlockReason; detail: string };

/**
 * Outstanding rupees on a single schedule line. `paid_amount` may hold a part
 * payment recorded against a line that is not yet closed, so the line's
 * outstanding is amount − received, floored at 0.
 */
export function lineOutstanding(line: InstallmentItem): number {
  const received = Number(line.paid_amount) || 0;
  return Math.max(0, (Number(line.amount) || 0) - received);
}

/**
 * Format an amount for the `Rs.{Fee_in_Rs}` slot: DIGITS ONLY.
 *
 * The approved body already prints the literal "Rs." before the token, so the
 * value must not repeat a currency marker — and it can't use ₹ anyway, which
 * validateBody blocks as non-GSM. No thousands separator: a comma is not a
 * digit and would read as a decimal point in some locales. Paise are shown only
 * when the underlying figure actually has them (no live line does today).
 */
export function formatFeeInRs(amount: number): string {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** An enrollment that represents a real admission, matching the EMI/at-risk filter. */
export function isReminderEligibleEnrollment(e: Pick<CourseEnrollment, "amount_paid" | "status">): boolean {
  return (e.amount_paid || 0) > 0 && e.status !== "cancelled";
}

/**
 * Resolve the ONE installment an SMS reminder should reference.
 *
 * "Oldest unpaid" is the first outstanding `installment` line in schedule order,
 * which is also the earliest-due one because buildSchedule emits them in due
 * order. Cancelled and waived lines are skipped (isLineOutstanding), so a
 * forgiven installment is never chased.
 */
export function resolveInstallmentForEnrollment(
  enrollment: CourseEnrollment,
  now = Date.now(),
): InstallmentResolution {
  if (!isReminderEligibleEnrollment(enrollment)) {
    // These two land on staff constantly: a "pending" enrollment still shows an
    // outstanding balance in the at-risk lists, so the reason has to explain why
    // a student who visibly owes money is not reminder-eligible.
    const detail = enrollment.status === "cancelled"
      ? "This enrollment is cancelled, so no installment is due."
      : "This student has not paid anything yet, so there is no installment plan running — they need an admission/seat-booking follow-up, not an installment reminder.";
    return { ok: false, reason: "no_active_enrollment", detail };
  }

  const derived = deriveCollections(enrollment, now);
  const schedule = enrollment.schedule || [];
  // ONLY `kind: "installment"`. A `seat` booking and a `full` payment are not
  // installments, and the approved body says "installment no. N", so referring
  // to either would make the message factually wrong.
  const unpaidInstallments = schedule.filter((s) => s.kind === "installment" && isLineOutstanding(s));

  if (unpaidInstallments.length === 0) {
    if (derived.remaining <= 0) {
      return { ok: false, reason: "zero_balance", detail: "This student has nothing left to pay." };
    }
    // The collections-gap case: money is owed and the row shows an outstanding
    // balance, but the only thing unpaid is a seat booking (or a one-shot full
    // payment). These students need an admission / seat-booking follow-up, not
    // an installment reminder, so they get their own reason rather than the
    // generic one — staff will meet this constantly on the at-risk worklist.
    const unpaidKinds = [...new Set(schedule.filter(isLineOutstanding).map((s) => s.kind))];
    if (unpaidKinds.length && unpaidKinds.every((k) => k === "seat" || k === "full")) {
      const what = unpaidKinds.includes("seat") ? "a seat booking" : "a one-shot full payment";
      return {
        ok: false,
        reason: "seat_booking_only",
        detail: `The only thing unpaid on this enrollment is ${what}, not an installment — this student needs an admission follow-up, not an installment reminder.`,
      };
    }
    return { ok: false, reason: "no_unpaid_installment", detail: "No unpaid installment line on this enrollment." };
  }

  const line = unpaidInstallments[0];
  const amountDue = lineOutstanding(line);
  if (amountDue <= 0) {
    return { ok: false, reason: "zero_balance", detail: "The next installment has nothing outstanding on it." };
  }

  return {
    ok: true,
    resolved: {
      enrollmentId: enrollment.id,
      courseTitle: enrollment.course_title,
      line,
      installmentNo: line.no,
      amountDue,
      totalRemaining: derived.remaining,
      dueDate: line.due ?? null,
      isOverdue: line.due != null && new Date(line.due).getTime() < now,
      unpaidCount: unpaidInstallments.length,
      pageNextPayableNo: derived.nextPayable?.no ?? null,
      matchesPageNextPayable: derived.nextPayable?.no === line.no,
    },
  };
}

/**
 * Pick the enrollment to chase when a student has several. Most overdue money
 * first, then the soonest due date — the same ordering the collections worklist
 * defaults to, so staff chase the same one the worklist puts at the top.
 */
export function pickReminderEnrollment(enrollments: CourseEnrollment[], now = Date.now()): CourseEnrollment | null {
  const candidates = enrollments
    .filter(isReminderEligibleEnrollment)
    .map((e) => ({ e, r: resolveInstallmentForEnrollment(e, now), d: deriveCollections(e, now) }))
    .filter((x) => x.r.ok);
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (b.d.overdueAmount !== a.d.overdueAmount) return b.d.overdueAmount - a.d.overdueAmount;
    const at = a.d.nextDueDate ? new Date(a.d.nextDueDate).getTime() : Infinity;
    const bt = b.d.nextDueDate ? new Date(b.d.nextDueDate).getTime() : Infinity;
    return at - bt;
  });
  return candidates[0].e;
}

/**
 * The variable values for the installment-reminder template. Keys are the
 * CANONICAL registry names; the alias table maps the DLT body's
 * `{No_of_Installment}` / `{Fee_in_Rs}` spellings onto them, so the approved
 * body text is never touched.
 */
export function installmentReminderVars(r: ResolvedInstallment): Record<string, string> {
  return {
    no_of_installment: String(r.installmentNo),
    fee_in_rs: formatFeeInRs(r.amountDue),
  };
}
