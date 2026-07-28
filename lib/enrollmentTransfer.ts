/**
 * Batch / course transfer — the pure decision layer.
 *
 * Everything here is a pure function of data handed to it: no I/O, no clock
 * unless passed one. The API route does the reading and the writing; this module
 * decides what a transfer WOULD do, so the impact preview a human approves and
 * the mutation that follows are computed by the same code rather than by two
 * implementations that can disagree.
 *
 * Three rules shape the whole file:
 *   1. Money is never invented or destroyed. Paid lines are carried across
 *      byte-for-byte; a fee difference is reported, never charged or refunded.
 *   2. A date is only as trustworthy as its source. Every start date carries its
 *      provenance so the preview can show a human where it came from.
 *   3. Nothing is silently possible. A condition we cannot verify becomes a block
 *      or a warning, never an assumption.
 */
import { addDaysISO } from "./dates";
import { batchTimings, buildBatchLabel, effectiveCourseForBatch, payInFullTotal } from "./installments";
import type { Course, CourseBatch, CourseEnrollment, InstallmentItem } from "./types";

/** Where a batch start date came from. The preview shows this verbatim. */
export type StartProvenance =
  /** Read from courses.batches[].start_date — structured and authoritative. */
  | "catalog"
  /** Recovered by parsing a free-text batch_label. Correct only if the label is. */
  | "parsed_label"
  /** No usable source. Due dates cannot be recalculated. */
  | "unknown";

export interface ResolvedStart {
  iso: string | null;
  provenance: StartProvenance;
  /** Plain-language sentence for the preview, e.g. what was parsed and from what. */
  detail: string;
  /**
   * Set when the catalog and the free-text label disagree. This is not
   * hypothetical: several live labels name a date their catalog batch does not.
   * The catalog wins, and the preview says so loudly.
   */
  conflict: { catalogISO: string; labelISO: string } | null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Recover a start date from a label such as "Starts 13 Jul 2026 · Morning".
 *
 * This is the inverse of buildBatchLabel(), which is what produces that format in
 * the first place — so for labels this app generated the parse is reliable. It is
 * NOT reliable for hand-typed labels, which is exactly why the result is tagged
 * `parsed_label` and shown to a human rather than used silently.
 *
 * Returns an ISO timestamp at IST midnight (18:30Z the previous day), matching how
 * the catalog stores start dates.
 */
export function parseStartFromLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const m = /(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})/.exec(label);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  const year = Number(m[3]);
  if (month === undefined || !Number.isFinite(day) || day < 1 || day > 31) return null;
  // IST midnight is 18:30Z on the previous calendar day.
  const utc = Date.UTC(year, month, day, 0, 0, 0) - 5.5 * 3600 * 1000;
  const d = new Date(utc);
  if (d.getUTCFullYear() !== year && d.getUTCFullYear() !== year - 1) return null;
  return d.toISOString();
}

/**
 * Establish a batch's start date and say where it came from.
 *
 * The catalog always wins when present, because it is structured data rather than
 * a sentence someone typed. When a label disagrees with the catalog we keep the
 * catalog value but record the conflict, so a preview can warn that the batch a
 * human thinks they are choosing starts on a different day than its name claims.
 */
export function resolveStart(batch: CourseBatch | null, label: string | null): ResolvedStart {
  const catalogISO = batch?.start_date ?? null;
  const labelISO = parseStartFromLabel(label);

  if (catalogISO) {
    const conflict =
      labelISO && !sameISTDay(catalogISO, labelISO) ? { catalogISO, labelISO } : null;
    return {
      iso: catalogISO,
      provenance: "catalog",
      detail: conflict
        ? `From the course catalog (batch ${batch!.id}). NOTE: the label says ${istDate(labelISO!)}, the catalog says ${istDate(catalogISO)} — the catalog is used.`
        : `From the course catalog (batch ${batch!.id}).`,
      conflict,
    };
  }
  if (labelISO) {
    return {
      iso: labelISO,
      provenance: "parsed_label",
      detail: `No start date is recorded on this batch in the catalog, so it was read out of the label ${JSON.stringify(label)} as ${istDate(labelISO)}. Check that date before committing.`,
      conflict: null,
    };
  }
  return {
    iso: null,
    provenance: "unknown",
    detail: label
      ? `Neither the catalog nor the label ${JSON.stringify(label)} yields a start date.`
      : "This batch has no start date and no label to read one from.",
    conflict: null,
  };
}

function istDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}
function sameISTDay(a: string, b: string): boolean {
  return istDate(a) === istDate(b);
}

// ─────────────────────────────── schedule rescheduling ───────────────────────────────

export interface LineChange {
  no: number;
  kind: string;
  label: string;
  amount: number;
  oldDue: string | null;
  newDue: string | null;
  paid: boolean;
  /** Why this line looks the way it does after the transfer. */
  effect: "untouched_paid" | "shifted" | "unchanged" | "amount_adjusted" | "added";
}

/**
 * Move the unpaid lines of a schedule onto a new batch start, leaving paid lines
 * exactly as they are.
 *
 * The rule is a UNIFORM SHIFT by the gap between the two batch starts, not a
 * rebuild. A rebuild would re-derive amounts and line counts from the target's EMI
 * config, which for a student who has already paid part of a plan would silently
 * restructure what they owe. Shifting keeps every amount, label and ordinal
 * identical and moves only the dates, which is the smallest change that satisfies
 * "due dates recalculate from the new batch start" — each unpaid line keeps its
 * offset from the start of its batch.
 *
 * A paid line is returned by reference-equal value: same amount, same paid_at,
 * same receipt and gateway references, same ordinal.
 */
export function rescheduleForNewStart(
  schedule: InstallmentItem[],
  oldStartISO: string | null,
  newStartISO: string | null,
): { schedule: InstallmentItem[]; shiftDays: number | null; changes: LineChange[] } {
  const shiftDays =
    oldStartISO && newStartISO
      ? Math.round((new Date(newStartISO).getTime() - new Date(oldStartISO).getTime()) / 86_400_000)
      : null;

  const changes: LineChange[] = [];
  const out = schedule.map((line) => {
    const isPaid = !!line.paid || line.status === "paid";
    // A paid line is history. It is not moved, not renumbered, not relabelled.
    if (isPaid) {
      changes.push({ no: line.no, kind: line.kind, label: line.label, amount: line.amount, oldDue: line.due ?? null, newDue: line.due ?? null, paid: true, effect: "untouched_paid" });
      return line;
    }
    // Waived/cancelled lines carry no obligation, so moving their date would only
    // invent meaning that is not there.
    if (line.status === "waived" || line.status === "cancelled" || line.due == null || shiftDays === null || shiftDays === 0) {
      changes.push({ no: line.no, kind: line.kind, label: line.label, amount: line.amount, oldDue: line.due ?? null, newDue: line.due ?? null, paid: false, effect: "unchanged" });
      return line;
    }
    const newDue = addDaysISO(line.due, shiftDays);
    changes.push({ no: line.no, kind: line.kind, label: line.label, amount: line.amount, oldDue: line.due, newDue, paid: false, effect: "shifted" });
    return { ...line, due: newDue };
  });

  return { schedule: out, shiftDays, changes };
}

// ─────────────────────────────── the plan ───────────────────────────────

export type BlockCode =
  | "same_target"
  | "enrollment_cancelled"
  | "enrollment_refunded"
  | "target_batch_ended"
  | "target_full"
  | "no_target_batch"
  | "legacy_enrollment";

export interface TransferBlock { code: BlockCode; detail: string; overridable: boolean }
export interface TransferWarning { code: string; detail: string }

export interface TransferPlan {
  blocks: TransferBlock[];
  warnings: TransferWarning[];
  source: {
    courseId: string; courseTitle: string; batchId: string | null; batchLabel: string | null;
    start: ResolvedStart; status: string; planType: string;
  };
  target: {
    courseId: string; courseTitle: string; batchId: string; batchLabel: string | null;
    start: ResolvedStart; courseChanged: boolean;
  };
  money: {
    oldTotal: number; newTotal: number; delta: number;
    direction: "same" | "higher" | "lower";
    amountPaid: number;
    oldOutstanding: number; newOutstanding: number;
    /** Set when the new fee is below what has already been paid. NEVER auto-refunded. */
    creditDue: number;
    /** Human sentence describing the financial consequence. */
    detail: string;
  };
  schedule: { before: InstallmentItem[]; after: InstallmentItem[]; shiftDays: number | null; changes: LineChange[] };
  seats: {
    source: { batchId: string | null; capacity: number | null; seatsLeft: number | null; after: number | null };
    target: { batchId: string; capacity: number | null; seatsLeft: number | null; after: number | null };
  };
  /** True when nothing about the money changes — the assertion the QA leans on. */
  financiallyNeutral: boolean;
}

export interface PlanTransferInput {
  enrollment: CourseEnrollment;
  sourceCourse: Course | null;
  targetCourse: Course;
  targetBatchId: string;
  /** Staff may proceed past a full batch with the right permission. */
  overrideCapacity?: boolean;
  now?: number;
}

/**
 * Compute the entire impact of a transfer without performing it.
 *
 * The same function backs both the preview and the commit, so what a human
 * approves is literally what gets written.
 */
export function planTransfer(input: PlanTransferInput): TransferPlan {
  const { enrollment: e, sourceCourse, targetCourse } = input;
  const now = input.now ?? Date.now();

  const blocks: TransferBlock[] = [];
  const warnings: TransferWarning[] = [];

  const targetBatch = (targetCourse.batches ?? []).find((b) => b.id === input.targetBatchId) ?? null;
  if (!targetBatch) {
    blocks.push({ code: "no_target_batch", detail: `The course "${targetCourse.title}" has no batch with id ${input.targetBatchId}.`, overridable: false });
  }

  const sourceBatch = (sourceCourse?.batches ?? []).find((b) => b.id === e.batch_id) ?? null;
  const sourceStart = resolveStart(sourceBatch, e.batch_label ?? null);
  const targetStart = resolveStart(targetBatch, targetBatch?.label ?? null);

  // ---- blocks ----
  const courseChanged = targetCourse.id !== e.course_id;
  if (!courseChanged && targetBatch && e.batch_id === targetBatch.id) {
    blocks.push({ code: "same_target", detail: "The student is already in this batch.", overridable: false });
  }
  const status = String(e.status ?? "").toLowerCase();
  if (status === "cancelled") blocks.push({ code: "enrollment_cancelled", detail: "This enrollment is cancelled and cannot be transferred.", overridable: false });
  if (status === "refunded") blocks.push({ code: "enrollment_refunded", detail: "This enrollment was refunded and cannot be transferred.", overridable: false });

  if (targetBatch?.end_date && new Date(targetBatch.end_date).getTime() < now) {
    blocks.push({ code: "target_batch_ended", detail: `That batch ended on ${istDate(targetBatch.end_date)}.`, overridable: false });
  }
  const seatsLeft = targetBatch?.seats_left ?? null;
  if (seatsLeft != null && seatsLeft <= 0) {
    blocks.push({
      code: "target_full",
      detail: `That batch has no seats left (capacity ${targetBatch?.capacity ?? "unknown"}). A senior admin can override, and the override is logged.`,
      overridable: true,
    });
  }

  // ---- money ----
  // The target batch's own pricing, via the same overlay the checkout uses, so a
  // transferred student is priced exactly like a fresh enrollment into that batch.
  const effTarget = targetBatch ? effectiveCourseForBatch(targetCourse, targetBatch.id) : targetCourse;
  const planType = String(e.plan_type ?? "full").toLowerCase();
  const newTotal = planType === "full" ? payInFullTotal(effTarget) : Math.round(effTarget.price || 0);
  const oldTotal = Math.round(e.total_fee || 0);
  const amountPaid = Math.round(e.amount_paid || 0);
  const delta = newTotal - oldTotal;
  const oldOutstanding = Math.max(0, oldTotal - amountPaid);
  const newOutstanding = Math.max(0, newTotal - amountPaid);
  const creditDue = Math.max(0, amountPaid - newTotal);

  const direction: "same" | "higher" | "lower" = delta === 0 ? "same" : delta > 0 ? "higher" : "lower";
  const money = {
    oldTotal, newTotal, delta, direction, amountPaid, oldOutstanding, newOutstanding, creditDue,
    detail:
      direction === "same"
        ? `Same fee. The ₹${amountPaid.toLocaleString("en-IN")} already paid carries over and ₹${newOutstanding.toLocaleString("en-IN")} remains outstanding, exactly as before.`
        : direction === "higher"
          ? `The new batch costs ₹${delta.toLocaleString("en-IN")} more. Outstanding rises from ₹${oldOutstanding.toLocaleString("en-IN")} to ₹${newOutstanding.toLocaleString("en-IN")}. NOTHING is charged — the student is invoiced through the normal schedule.`
          : creditDue > 0
            ? `The new batch costs ₹${Math.abs(delta).toLocaleString("en-IN")} less, and that puts the student ₹${creditDue.toLocaleString("en-IN")} in credit. NOTHING is refunded automatically — this is flagged for manual handling.`
            : `The new batch costs ₹${Math.abs(delta).toLocaleString("en-IN")} less. Outstanding falls from ₹${oldOutstanding.toLocaleString("en-IN")} to ₹${newOutstanding.toLocaleString("en-IN")}. NOTHING is refunded.`,
  };

  // ---- schedule ----
  const before = Array.isArray(e.schedule) ? e.schedule : [];
  const resched = rescheduleForNewStart(before, sourceStart.iso, targetStart.iso);
  let after = resched.schedule;
  const changes = [...resched.changes];

  if (resched.shiftDays === null && before.some((l) => !l.paid && l.due)) {
    warnings.push({
      code: "cannot_recalculate_dates",
      detail:
        sourceStart.provenance === "unknown"
          ? "The CURRENT batch has no resolvable start date, so there is nothing to measure the shift from. Unpaid due dates are left where they are."
          : "The TARGET batch has no resolvable start date, so unpaid due dates are left where they are.",
    });
  }

  // A higher fee has to land somewhere. It joins the LAST unpaid line rather than
  // creating a new one, so the plan the student agreed to keeps its shape.
  if (delta > 0) {
    const idx = lastUnpaidIndex(after);
    if (idx >= 0) {
      const line = after[idx];
      const adjusted = { ...line, amount: line.amount + delta };
      after = after.map((l, i) => (i === idx ? adjusted : l));
      const ch = changes.find((c) => c.no === line.no && !c.paid);
      if (ch) { ch.amount = adjusted.amount; ch.effect = "amount_adjusted"; }
    } else {
      // Everything is paid, yet the new batch costs more: the difference becomes a
      // new payable line rather than vanishing.
      const nextNo = Math.max(0, ...after.map((l) => l.no)) + 1;
      const line: InstallmentItem = { no: nextNo, kind: "installment", label: "Fee difference on transfer", amount: delta, due: targetStart.iso, paid: false };
      after = [...after, line];
      changes.push({ no: nextNo, kind: line.kind, label: line.label, amount: delta, oldDue: null, newDue: line.due, paid: false, effect: "added" });
    }
  } else if (delta < 0) {
    const reduction = Math.min(-delta, after.filter((l) => !l.paid).reduce((a, l) => a + l.amount, 0));
    if (reduction > 0) {
      let left = reduction;
      after = after.map((l) => {
        if (l.paid || left <= 0) return l;
        const cut = Math.min(l.amount, left);
        left -= cut;
        const ch = changes.find((c) => c.no === l.no && !c.paid);
        if (ch) { ch.amount = l.amount - cut; ch.effect = "amount_adjusted"; }
        return { ...l, amount: l.amount - cut };
      });
    }
    if (creditDue > 0) {
      warnings.push({ code: "credit_due", detail: `The student has paid ₹${creditDue.toLocaleString("en-IN")} more than the new fee. Recorded as a credit for manual handling; no refund is issued.` });
    }
  }

  // ---- date-shift warnings that matter commercially ----
  const pushedLater = resched.changes.filter((c) => !c.paid && c.oldDue && c.newDue && new Date(c.newDue) > new Date(c.oldDue));
  if (pushedLater.length) {
    warnings.push({
      code: "deadline_moves_later",
      detail: `${pushedLater.length} unpaid line${pushedLater.length === 1 ? "" : "s"} move later by ${resched.shiftDays} day${Math.abs(resched.shiftDays ?? 0) === 1 ? "" : "s"}. This delays when the money is collectable.`,
    });
  }
  if (targetStart.conflict) {
    warnings.push({ code: "label_disagrees_with_catalog", detail: targetStart.detail });
  }
  if (targetStart.provenance === "parsed_label") {
    warnings.push({ code: "start_date_parsed", detail: targetStart.detail });
  }
  const nowOverdue = before.filter((l) => !l.paid && l.due && new Date(l.due).getTime() < now).length;
  const afterOverdue = after.filter((l) => !l.paid && l.due && new Date(l.due).getTime() < now).length;
  if (nowOverdue !== afterOverdue) {
    warnings.push({ code: "overdue_changes", detail: `Overdue unpaid lines change from ${nowOverdue} to ${afterOverdue}; At-Risk Fees will reflect the new dates.` });
  }

  return {
    blocks, warnings,
    source: {
      courseId: e.course_id, courseTitle: e.course_title ?? sourceCourse?.title ?? "",
      batchId: e.batch_id ?? null, batchLabel: e.batch_label ?? null,
      start: sourceStart, status: String(e.status ?? ""), planType,
    },
    target: {
      courseId: targetCourse.id, courseTitle: targetCourse.title,
      batchId: input.targetBatchId,
      batchLabel: targetBatch ? buildBatchLabel(targetBatch.start_date ?? null, batchTimings(targetBatch)) ?? targetBatch.label : null,
      start: targetStart, courseChanged,
    },
    money,
    schedule: { before, after, shiftDays: resched.shiftDays, changes },
    seats: {
      source: { batchId: e.batch_id ?? null, capacity: sourceBatch?.capacity ?? null, seatsLeft: sourceBatch?.seats_left ?? null, after: sourceBatch?.seats_left != null ? sourceBatch.seats_left + 1 : null },
      target: { batchId: input.targetBatchId, capacity: targetBatch?.capacity ?? null, seatsLeft: seatsLeft, after: seatsLeft != null ? seatsLeft - 1 : null },
    },
    financiallyNeutral: delta === 0 && creditDue === 0,
  };
}

function lastUnpaidIndex(s: InstallmentItem[]): number {
  for (let i = s.length - 1; i >= 0; i--) {
    if (!s[i].paid && s[i].status !== "waived" && s[i].status !== "cancelled") return i;
  }
  return -1;
}

/** A transfer may proceed when nothing blocks it, or the only block is an overridden capacity block. */
export function transferIsPermitted(plan: TransferPlan, opts: { overrideCapacity?: boolean } = {}): boolean {
  return plan.blocks.every((b) => b.code === "target_full" && b.overridable && !!opts.overrideCapacity);
}
