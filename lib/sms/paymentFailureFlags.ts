/**
 * Payment-failure detection for Access At Risk. Students whose gateway attempts
 * keep failing should get a phone call, not another "pay installment X" SMS.
 */
import { getSupabaseAdmin } from "../supabase";
import { pageThrough, getCourseEnrollmentById } from "../dataProvider";
import { flagNeedsCall } from "./accessCapStore";
import { resolveInstallmentForEnrollment } from "./installmentReminder";

export const FAILED_ATTEMPT_WINDOW_DAYS = 14;
export const FAILED_ATTEMPT_THRESHOLD = 2;
/** VERIFYING older than this is a data-integrity alert, not a collections SMS case. */
export const VERIFYING_STUCK_HOURS = 24;

export interface PaymentFailureHit {
  enrollmentId: string;
  phone: string;
  studentName: string;
  failedCount: number;
  verifyingStuck: number;
  lastAttemptAt: string | null;
  reason: "failed_attempts" | "verifying_stuck" | "both";
}

export async function scanPaymentFailures(now = Date.now()): Promise<{
  failedAttempts: PaymentFailureHit[];
  verifyingStuck: PaymentFailureHit[];
  totals: { failedStudents: number; verifyingStuckStudents: number; failedRows: number; verifyingStuckRows: number };
}> {
  const db = getSupabaseAdmin();
  if (!db) {
    return {
      failedAttempts: [], verifyingStuck: [],
      totals: { failedStudents: 0, verifyingStuckStudents: 0, failedRows: 0, verifyingStuckRows: 0 },
    };
  }

  const failedSince = new Date(now - FAILED_ATTEMPT_WINDOW_DAYS * 86_400_000).toISOString();
  const verifyingBefore = new Date(now - VERIFYING_STUCK_HOURS * 3600_000).toISOString();

  const failedRows = await pageThrough<{
    id: string; enrollment_id: string | null; phone: string; student_name: string | null; status: string; created_at: string;
  }>(() => db.from("payments")
    .select("id, enrollment_id, phone, student_name, status, created_at")
    .eq("status", "FAILED")
    .is("deleted_at", null)
    .gte("created_at", failedSince)
    .order("id"));

  const verifyingRows = await pageThrough<{
    id: string; enrollment_id: string | null; phone: string; student_name: string | null; status: string; created_at: string;
  }>(() => db.from("payments")
    .select("id, enrollment_id, phone, student_name, status, created_at")
    .eq("status", "VERIFYING")
    .is("deleted_at", null)
    .lt("created_at", verifyingBefore)
    .order("id"));

  type Acc = { enrollmentId: string; phone: string; studentName: string; failed: number; verifying: number; last: string | null };
  const byKey = new Map<string, Acc>();

  const bump = (row: { enrollment_id: string | null; phone: string; student_name: string | null; created_at: string }, kind: "failed" | "verifying") => {
    const enrollmentId = row.enrollment_id || `phone:${row.phone}`;
    const key = enrollmentId;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { enrollmentId, phone: row.phone, studentName: row.student_name || "—", failed: 0, verifying: 0, last: null };
      byKey.set(key, acc);
    }
    if (kind === "failed") acc.failed++;
    else acc.verifying++;
    if (!acc.last || acc.last < row.created_at) acc.last = row.created_at;
  };

  for (const r of failedRows) bump(r, "failed");
  for (const r of verifyingRows) bump(r, "verifying");

  const failedAttempts: PaymentFailureHit[] = [];
  const verifyingStuck: PaymentFailureHit[] = [];
  for (const acc of byKey.values()) {
    if (acc.failed < FAILED_ATTEMPT_THRESHOLD && acc.verifying === 0) continue;
    const reason: PaymentFailureHit["reason"] =
      acc.failed >= FAILED_ATTEMPT_THRESHOLD && acc.verifying > 0 ? "both"
        : acc.failed >= FAILED_ATTEMPT_THRESHOLD ? "failed_attempts"
          : "verifying_stuck";
    const hit: PaymentFailureHit = {
      enrollmentId: acc.enrollmentId,
      phone: acc.phone,
      studentName: acc.studentName,
      failedCount: acc.failed,
      verifyingStuck: acc.verifying,
      lastAttemptAt: acc.last,
      reason,
    };
    if (acc.failed >= FAILED_ATTEMPT_THRESHOLD) failedAttempts.push(hit);
    if (acc.verifying > 0) verifyingStuck.push(hit);
  }

  return {
    failedAttempts,
    verifyingStuck,
    totals: {
      failedStudents: failedAttempts.length,
      verifyingStuckStudents: verifyingStuck.length,
      failedRows: failedRows.length,
      verifyingStuckRows: verifyingRows.length,
    },
  };
}

/** Flag matching enrollments needs_call so automation skips them. Manual send still available. */
export async function applyPaymentFailureFlags(hits: PaymentFailureHit[]): Promise<number> {
  let n = 0;
  for (const h of hits) {
    if (!h.enrollmentId || h.enrollmentId.startsWith("phone:")) continue;
    const enr = await getCourseEnrollmentById(h.enrollmentId).catch(() => null);
    const resolved = enr ? resolveInstallmentForEnrollment(enr) : null;
    const installmentNo = resolved?.ok ? resolved.resolved.installmentNo : 0;
    const reasonParts: string[] = [];
    if (h.failedCount >= FAILED_ATTEMPT_THRESHOLD) {
      reasonParts.push(`${h.failedCount} FAILED attempts in ${FAILED_ATTEMPT_WINDOW_DAYS}d`);
    }
    if (h.verifyingStuck > 0) reasonParts.push(`Stuck VERIFYING (${h.verifyingStuck})`);
    if (h.lastAttemptAt) reasonParts.push(`last ${h.lastAttemptAt.slice(0, 10)}`);
    await flagNeedsCall({
      courseEnrollmentId: h.enrollmentId,
      installmentNo,
      reason: reasonParts.join(" · ") || "Payment failure",
      normalizedMobile: null,
      studentId: enr?.student_id ?? null,
    });
    n++;
  }
  return n;
}
