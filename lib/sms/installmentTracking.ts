/**
 * Reminder → payment tracking for a whole page of enrollments.
 *
 * ONE query for every installment-reminder log, then an in-memory join. The
 * alternative — a lookup per row — is what the brief forbids, and at 148
 * at-risk enrollments it would be 148 round-trips for a table that renders in
 * one pass.
 *
 * Everything reported here is CORRELATION BY TIMING. See the wording note on
 * ReminderStateKind in ./installmentAttribution.
 */
import { normalizeIndianMobile } from "../phone";
import { listAttributionLogs, type AttributionLogRow } from "./store";
import { INSTALLMENT_REMINDER_TEMPLATE_ID } from "./installmentReminderService";
import {
  aggregateStats, rowReminderState, installmentReminderStates,
  type AggregateStats, type InstallmentReminderState,
} from "./installmentAttribution";
import type { CourseEnrollment } from "../types";

export interface EnrollmentTracking {
  enrollmentId: string;
  /** State for the installment a reminder would target now (oldest unpaid). */
  row: InstallmentReminderState | null;
  /** Every installment's state, so a profile view can list them independently. */
  perInstallment: InstallmentReminderState[];
}

export interface TrackingResult {
  byEnrollment: Map<string, EnrollmentTracking>;
  aggregate: AggregateStats;
}

/**
 * Attach reminder/payment state to each enrollment.
 *
 * Keyless logs (reminders sent before the attribution columns existed) are
 * matched to an enrollment by NORMALIZED PHONE only. That is deliberately weaker
 * than the keyed path and never produces a confident attribution — it exists so
 * a historically reminded student shows "Reminded — installment not recorded"
 * rather than "Not reminded", which would be a lie. When a phone maps to more
 * than one enrollment the log is attached to each, because we cannot tell which
 * course it was about; every such row renders as unattributable anyway.
 */
export async function buildTracking(
  enrollments: Pick<CourseEnrollment, "id" | "phone" | "schedule" | "payment_plan_changed_at">[],
  now = Date.now(),
): Promise<TrackingResult> {
  const logs = await listAttributionLogs(INSTALLMENT_REMINDER_TEMPLATE_ID, enrollments.map((e) => e.id));

  const byEnrollmentId = new Map<string, AttributionLogRow[]>();
  const keylessByMobile = new Map<string, AttributionLogRow[]>();
  for (const l of logs) {
    if (l.course_enrollment_id) {
      const list = byEnrollmentId.get(l.course_enrollment_id);
      if (list) list.push(l); else byEnrollmentId.set(l.course_enrollment_id, [l]);
    } else if (l.normalized_mobile) {
      const list = keylessByMobile.get(l.normalized_mobile);
      if (list) list.push(l); else keylessByMobile.set(l.normalized_mobile, [l]);
    }
  }

  const byEnrollment = new Map<string, EnrollmentTracking>();
  const rowStates: (InstallmentReminderState | null)[] = [];

  for (const e of enrollments) {
    const n = normalizeIndianMobile(e.phone || "");
    const keyed = byEnrollmentId.get(e.id) ?? [];
    const keyless = n.ok && n.digits10 ? (keylessByMobile.get(n.digits10) ?? []) : [];
    const all = [...keyed, ...keyless];

    const perInstallment = installmentReminderStates(e, all, now);
    const row = rowReminderState(e, all, now);
    byEnrollment.set(e.id, { enrollmentId: e.id, row, perInstallment });
    rowStates.push(row);
  }

  return { byEnrollment, aggregate: aggregateStats(rowStates) };
}

/** Serialisable shape for the client (Maps do not survive JSON). */
export interface TrackingPayload {
  byEnrollment: Record<string, EnrollmentTracking>;
  aggregate: AggregateStats;
}

export function serialiseTracking(result: TrackingResult): TrackingPayload {
  const byEnrollment: Record<string, EnrollmentTracking> = {};
  for (const [id, v] of result.byEnrollment) byEnrollment[id] = v;
  return { byEnrollment, aggregate: result.aggregate };
}
