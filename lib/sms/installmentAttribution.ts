/**
 * Reminder -> payment attribution, PER INSTALLMENT.
 *
 * Everything here is correlation by TIMING. A payment that lands after a
 * reminder is reported as "Paid Nd after reminder" and nothing more: no
 * "converted", no "recovered", no revenue credited to a reminder. The wording is
 * load-bearing, not cosmetic — see REMINDER_STATE_* below.
 *
 * WHY THIS IS HARDER THAN A JOIN
 *   Installments are not rows. There is no installments table; a schedule is a
 *   JSONB array on course_enrollments and a line's only identity is its ordinal
 *   `no` inside that array — in a document that demonstrably gets restructured
 *   (9 of 310 enrollments carry payment_plan_changed_at, 6 are superseded). So
 *   an attribution keyed on the ordinal alone can silently re-point at a
 *   different installment after a plan change, which the brief forbids
 *   outright. The tiered match below never trusts the ordinal on its own.
 *
 * Pure: no I/O. Callers supply the enrollment and its reminder logs.
 */
import { isLineOutstanding } from "../installments";
import type { CourseEnrollment, InstallmentItem } from "../types";

/** Rounded to whole rupees so a float amount can still match its fingerprint. */
function fingerprintAmount(amount: unknown): string {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Immutable identity of a schedule line: `kind|due-date|amount`.
 *
 * Deliberately NOT including `no` (the thing that moves) or `label` (free text
 * an admin can retitle without changing which installment it is). The due date
 * is reduced to a calendar day so a time-of-day rewrite does not break the
 * match.
 *
 * NOT GUARANTEED UNIQUE. Two installments in one plan that share kind, due date
 * and amount produce the same fingerprint, and they are NOT interchangeable —
 * they are two separate obligations. `attributeReminders` therefore treats a
 * fingerprint matching more than one line as ambiguous and falls back to the
 * ordinal, or refuses, rather than picking one.
 */
export function installmentFingerprint(line: Pick<InstallmentItem, "kind" | "due" | "amount">): string {
  const day = line.due ? String(line.due).slice(0, 10) : "no-due";
  return `${line.kind}|${day}|${fingerprintAmount(line.amount)}`;
}

/** Only `kind: "installment"` is an installment. `seat` and `full` are not. */
export function isInstallmentLine(line: Pick<InstallmentItem, "kind">): boolean {
  return line.kind === "installment";
}

/** Unpaid, not cancelled/waived, and genuinely an installment. */
export function isOutstandingInstallment(line: InstallmentItem): boolean {
  return isInstallmentLine(line) && isLineOutstanding(line);
}

/** The minimum a reminder log must carry to take part in attribution. */
export interface ReminderLogLike {
  id: string;
  course_enrollment_id?: string | null;
  installment_no?: number | null;
  installment_fingerprint?: string | null;
  status: string;
  sent_at?: string | null;
  created_at: string;
  sent_by_user_id?: string | null;
  sent_by_type?: string | null;
  template_id?: string | null;
}

/** Only sends that plausibly reached a handset count as "reminded". */
const REMINDED_STATUSES = new Set(["SENT", "DELIVERED", "QUEUED"]);

export function isRemindedStatus(status: string): boolean {
  return REMINDED_STATUSES.has(String(status || "").toUpperCase());
}

/** Effective moment a reminder went out. */
export function reminderAt(log: ReminderLogLike): string {
  return log.sent_at || log.created_at;
}

/**
 * How confidently a reminder log was tied to a specific installment.
 * `ordinal` is only ever used when we can PROVE the plan has not been
 * restructured since the send.
 */
export type AttributionConfidence = "fingerprint" | "ordinal";

export interface MatchedReminder {
  log: ReminderLogLike;
  at: string;
  confidence: AttributionConfidence;
}

/**
 * Reminders that cannot be tied to a line on the CURRENT schedule. Surfaced,
 * never silently dropped.
 *   `plan_changed` — the plan was restructured after this reminder went out
 *   `no_key`       — predates the attribution columns (historical rows)
 *   `line_gone`    — keyed correctly, but that exact line is no longer on the plan
 *   `ambiguous`    — the line's identity now matches two or more installments
 */
export type UnmatchedReason = "plan_changed" | "no_key" | "line_gone" | "ambiguous";

export interface UnmatchedReminder {
  log: ReminderLogLike;
  at: string;
  reason: UnmatchedReason;
}

export interface AttributionResult {
  /** Reminders per installment ordinal on the current schedule. */
  byInstallmentNo: Map<number, MatchedReminder[]>;
  unmatched: UnmatchedReminder[];
}

/**
 * Tie each reminder log to an installment on the enrollment's CURRENT schedule.
 *
 * Tier 1 — fingerprint matches EXACTLY ONE line. Survives a renumbering: the
 *          line moved but is still demonstrably the same installment.
 * Tier 2 — the ordinal, allowed only when the plan has not changed since the
 *          send (`payment_plan_changed_at <= sent_at`, or never changed), and
 *          only when the fingerprint did not positively contradict it. Safe
 *          precisely because nothing has been restructured in between.
 * Tier 3 — no confident answer. Reported with a reason rather than guessed at.
 *
 * A recorded fingerprint that matches NOTHING is treated as evidence that the
 * line's identity changed, so the ordinal is NOT used as a fallback in that
 * case: attributing to the same slot with a different amount or due date would
 * credit a payment to an obligation the student was never told about.
 */
export function attributeReminders(
  enrollment: Pick<CourseEnrollment, "id" | "schedule" | "payment_plan_changed_at">,
  logs: ReminderLogLike[],
): AttributionResult {
  const schedule = enrollment.schedule || [];
  const installments = schedule.filter(isInstallmentLine);

  // ALL lines per fingerprint, not the first: a duplicate must be detected, not
  // silently resolved to whichever line happened to come first in the array.
  const byFingerprint = new Map<string, InstallmentItem[]>();
  for (const line of installments) {
    const fp = installmentFingerprint(line);
    const list = byFingerprint.get(fp);
    if (list) list.push(line); else byFingerprint.set(fp, [line]);
  }
  const byNo = new Map<number, InstallmentItem>();
  for (const line of installments) byNo.set(line.no, line);

  const planChangedAt = enrollment.payment_plan_changed_at
    ? new Date(enrollment.payment_plan_changed_at).getTime()
    : null;

  const byInstallmentNo = new Map<number, MatchedReminder[]>();
  const unmatched: UnmatchedReminder[] = [];

  const push = (no: number, m: MatchedReminder) => {
    const list = byInstallmentNo.get(no);
    if (list) list.push(m);
    else byInstallmentNo.set(no, [m]);
  };

  for (const log of logs) {
    if (!isRemindedStatus(log.status)) continue;
    const at = reminderAt(log);

    if (!log.course_enrollment_id) {
      unmatched.push({ log, at, reason: "no_key" });
      continue;
    }

    const sentMs = new Date(at).getTime();
    const planMovedSince = planChangedAt != null && planChangedAt > sentMs;

    // Tier 1: the line's own immutable identity, but only when it is unique.
    const fpHits = log.installment_fingerprint ? (byFingerprint.get(log.installment_fingerprint) ?? []) : null;
    if (fpHits && fpHits.length === 1) {
      push(fpHits[0]!.no, { log, at, confidence: "fingerprint" });
      continue;
    }
    if (fpHits && fpHits.length === 0) {
      // The identity we recorded is gone. Do NOT fall back to the ordinal.
      unmatched.push({ log, at, reason: planMovedSince ? "plan_changed" : "line_gone" });
      continue;
    }

    // Tier 2: the ordinal — either no fingerprint was recorded, or it matched
    // several lines and the ordinal is what tells them apart. Requires a plan
    // that provably has not moved since the send.
    if (!planMovedSince && log.installment_no != null) {
      const hit = byNo.get(log.installment_no);
      if (hit) {
        // With an ambiguous fingerprint, the ordinal must still land on a line
        // carrying that identity, or the two disagree and we refuse.
        if (!fpHits || fpHits.some((l) => l.no === hit.no)) {
          push(hit.no, { log, at, confidence: "ordinal" });
          continue;
        }
        unmatched.push({ log, at, reason: "ambiguous" });
        continue;
      }
      unmatched.push({ log, at, reason: "line_gone" });
      continue;
    }

    unmatched.push({ log, at, reason: planMovedSince ? "plan_changed" : (fpHits ? "ambiguous" : "line_gone") });
  }

  for (const list of byInstallmentNo.values()) {
    list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }
  return { byInstallmentNo, unmatched };
}

/**
 * The single state shown on a row, per installment. Exactly one applies.
 *
 * WORDING IS DELIBERATE. "paid_after_reminder" reports TIMING ONLY. Do not
 * relabel these as converted / recovered / "reminder worked", and do not
 * attribute revenue to a reminder anywhere in the UI or an export. A student
 * who was reminded and later paid may well have paid regardless.
 */
export type ReminderStateKind =
  | "not_reminded"
  | "reminded"
  | "paid_after_reminder"
  | "paid_no_reminder"
  | "reminded_unattributable";

export interface InstallmentReminderState {
  installmentNo: number;
  kind: ReminderStateKind;
  /** Whole days since the FIRST reminder for this installment. */
  daysSinceFirstReminder: number | null;
  /** Whole days since the MOST RECENT reminder (hover detail). */
  daysSinceLastReminder: number | null;
  reminderCount: number;
  firstReminderAt: string | null;
  lastReminderAt: string | null;
  lastReminderBy: string | null;
  /**
   * Days between the FIRST reminder and the payment. Floored; 0 renders as
   * "Paid same day". Null unless kind is "paid_after_reminder".
   */
  daysToPayment: number | null;
  paidAt: string | null;
  /** Still owed on this line — a partial payment is NOT paid. */
  outstanding: number;
  amount: number;
  dueDate: string | null;
  isOverdue: boolean;
  /** Set when reminders exist but could not be tied to this line. */
  unattributableReason: UnmatchedReason | null;
  label: string;
}

/** Whole days between two instants, floored at 0. */
function wholeDaysBetween(fromISO: string, toMs: number): number {
  const from = new Date(fromISO).getTime();
  return Math.max(0, Math.floor((toMs - from) / 86_400_000));
}

/**
 * Outstanding on one line. `paid_amount` is absent from every live row today
 * (lines are binary paid/unpaid in practice) but it is in the type, so a part
 * payment recorded against an open line is still honoured.
 */
export function lineOutstandingAmount(line: InstallmentItem): number {
  if (line.paid) return 0;
  const received = Number(line.paid_amount) || 0;
  return Math.max(0, (Number(line.amount) || 0) - received);
}

/**
 * Per-installment reminder/payment state for one enrollment.
 *
 * Only `kind: "installment"` lines get a state — a seat booking is not an
 * installment and must never be reported as one.
 */
export function installmentReminderStates(
  enrollment: Pick<CourseEnrollment, "id" | "schedule" | "payment_plan_changed_at">,
  logs: ReminderLogLike[],
  now = Date.now(),
): InstallmentReminderState[] {
  const { byInstallmentNo, unmatched } = attributeReminders(enrollment, logs);
  const schedule = enrollment.schedule || [];

  // An unmatched reminder still belongs to this enrollment, so the row must say
  // so rather than look un-reminded. Attach it to the oldest unpaid installment
  // — the line a reminder would have targeted — and flag it as unattributable.
  const oldestUnpaid = schedule.filter(isOutstandingInstallment)[0] ?? null;
  const unmatchedForOldest = unmatched.length ? unmatched : [];

  return schedule.filter(isInstallmentLine).map((line) => {
    const matched = byInstallmentNo.get(line.no) ?? [];
    const outstanding = lineOutstandingAmount(line);
    const paidAt = line.paid ? (line.paid_at ?? null) : null;
    const isOverdue = !line.paid && line.due != null && new Date(line.due).getTime() < now;

    const claimsUnmatched = oldestUnpaid != null && line.no === oldestUnpaid.no && matched.length === 0 && unmatchedForOldest.length > 0;
    const relevantUnmatched = claimsUnmatched ? unmatchedForOldest : [];

    const first = matched[0] ?? null;
    const last = matched.length ? matched[matched.length - 1] : null;

    const base = {
      installmentNo: line.no,
      reminderCount: matched.length,
      firstReminderAt: first?.at ?? null,
      lastReminderAt: last?.at ?? null,
      lastReminderBy: last?.log.sent_by_user_id ?? null,
      daysSinceFirstReminder: first ? wholeDaysBetween(first.at, now) : null,
      daysSinceLastReminder: last ? wholeDaysBetween(last.at, now) : null,
      outstanding,
      amount: Number(line.amount) || 0,
      dueDate: line.due ?? null,
      isOverdue,
      label: line.label || `Installment ${line.no}`,
      unattributableReason: relevantUnmatched.length ? relevantUnmatched[0]!.reason : null,
    };

    // A part payment is NOT paid: keep the reminded state and the balance.
    const fullyPaid = line.paid && outstanding <= 0;

    if (fullyPaid) {
      // A payment that predates every reminder was never prompted by one. Also
      // covers a refund-then-repay ordering: no reminder before it, no claim.
      if (!first || !paidAt) {
        return { ...base, kind: "paid_no_reminder" as const, daysToPayment: null, paidAt };
      }
      const paidMs = new Date(paidAt).getTime();
      const firstMs = new Date(first.at).getTime();
      if (paidMs < firstMs) {
        return { ...base, kind: "paid_no_reminder" as const, daysToPayment: null, paidAt };
      }
      return {
        ...base,
        kind: "paid_after_reminder" as const,
        daysToPayment: wholeDaysBetween(first.at, paidMs),
        paidAt,
      };
    }

    // Not paid (or only partly paid). A refund flips `paid` back to false, so
    // this branch is also how a reversal returns to the reminded state.
    if (matched.length) {
      return { ...base, kind: "reminded" as const, daysToPayment: null, paidAt: null };
    }
    if (relevantUnmatched.length) {
      return { ...base, kind: "reminded_unattributable" as const, daysToPayment: null, paidAt: null };
    }
    return { ...base, kind: "not_reminded" as const, daysToPayment: null, paidAt: null };
  });
}

/** The one installment a reminder targets: OLDEST UNPAID, seat/full excluded. */
export function oldestUnpaidInstallment(
  enrollment: Pick<CourseEnrollment, "schedule">,
): InstallmentItem | null {
  return (enrollment.schedule || []).filter(isOutstandingInstallment)[0] ?? null;
}

/**
 * The state for the installment a reminder would target now — what a row shows.
 * Null when there is no unpaid installment (e.g. only an unpaid seat booking).
 */
export function rowReminderState(
  enrollment: Pick<CourseEnrollment, "id" | "schedule" | "payment_plan_changed_at">,
  logs: ReminderLogLike[],
  now = Date.now(),
): InstallmentReminderState | null {
  const target = oldestUnpaidInstallment(enrollment);
  const states = installmentReminderStates(enrollment, logs, now);
  if (target) return states.find((s) => s.installmentNo === target.no) ?? null;
  // Fully paid: report the most recently paid installment so a row that just
  // settled still shows "Paid Nd after reminder" instead of going blank.
  const paid = states.filter((s) => s.paidAt).sort((a, b) => new Date(b.paidAt!).getTime() - new Date(a.paidAt!).getTime());
  return paid[0] ?? null;
}

export interface AggregateStats {
  reminded: number;
  paidAfterReminder: number;
  /** MEDIAN days to payment, not mean — one 60-day outlier must not move it. */
  medianDaysToPayment: number | null;
  stillPending: number;
}

/** Median of a numeric list (average of the middle two when even). */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round(((s[mid - 1]! + s[mid]!) / 2) * 10) / 10;
}

/** Header line for the current filter. Counts installments, not students. */
export function aggregateStats(states: (InstallmentReminderState | null)[]): AggregateStats {
  let reminded = 0, paidAfterReminder = 0, stillPending = 0;
  const days: number[] = [];
  for (const s of states) {
    if (!s) continue;
    const wasReminded = s.reminderCount > 0 || s.kind === "reminded_unattributable";
    if (wasReminded) reminded++;
    if (s.kind === "paid_after_reminder") {
      paidAfterReminder++;
      if (s.daysToPayment != null) days.push(s.daysToPayment);
    }
    if (wasReminded && s.outstanding > 0) stillPending++;
  }
  return { reminded, paidAfterReminder, medianDaysToPayment: median(days), stillPending };
}
