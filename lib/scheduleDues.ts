/**
 * Materialize installment due dates when a checkout intent becomes a real
 * paid enrolment. Amounts and paid flags are preserved exactly.
 */
import { addMonthsISO } from "./dates";
import { firstInstallmentDueISO, resolveEmiConfig } from "./installments";
import type { Course, CourseEnrollment, InstallmentItem } from "./types";

export function materializeScheduleDues(
  schedule: InstallmentItem[],
  opts: {
    bookingISO: string;
    course?: Course | null;
    batchStartISO?: string | null;
  },
): InstallmentItem[] {
  const cfg = opts.course ? resolveEmiConfig(opts.course) : null;
  const firstIntervalDays = cfg?.firstIntervalDays ?? 7;
  const intervalMonths = cfg?.intervalMonths ?? 1;
  const installmentNos = schedule
    .filter((s) => s.kind === "installment")
    .map((s) => s.no)
    .sort((a, b) => a - b);
  if (!installmentNos.length) return schedule;
  const firstNo = installmentNos[0];
  const firstDue = firstInstallmentDueISO(opts.bookingISO, firstIntervalDays, opts.batchStartISO ?? null);
  const dueByNo = new Map<number, string>();
  for (const no of installmentNos) {
    const offset = Math.max(0, no - firstNo);
    dueByNo.set(no, offset === 0 ? firstDue : addMonthsISO(firstDue, offset * intervalMonths));
  }
  return schedule.map((s) => {
    if (s.kind !== "installment") return s;
    // Never rewrite a paid line's due date.
    if (s.paid) return s;
    // Only fill missing dues — leave explicit dates alone (admin edits).
    if (s.due) return s;
    const due = dueByNo.get(s.no);
    return due ? { ...s, due } : s;
  });
}

export function needsDueMaterialization(enrollment: Pick<CourseEnrollment, "schedule" | "amount_paid" | "status">): boolean {
  if ((enrollment.amount_paid || 0) <= 0 && enrollment.status !== "fully_paid") return false;
  return (enrollment.schedule || []).some(
    (s) => s.kind === "installment" && !s.paid && !s.due && s.status !== "cancelled" && s.status !== "waived",
  );
}
