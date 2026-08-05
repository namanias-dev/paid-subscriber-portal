/**
 * `course_enrollments.amount_paid` is a CACHE of fee-state netPaid.
 * Single writer: syncAmountPaidFromFeeState. No money math / gating / student
 * output should read the column for amounts — existence gates (amount_paid > 0)
 * may remain.
 */
import { getSupabaseAdmin } from "./supabase";
import { enrollmentFeeStateFromEnrollment } from "./enrollmentFeeState";
import type { CourseEnrollment } from "./types";

export type AmountPaidDriftRow = {
  id: string;
  student_name: string;
  phone: string;
  column: number;
  feeState: number;
};

/** Recompute amount_paid from schedule/fee-state and write the cache column. */
export async function syncAmountPaidFromFeeState(
  enrollment:
    | string
    | Pick<CourseEnrollment, "id" | "total_fee" | "schedule" | "discount_amount" | "amount_paid">,
): Promise<{ ok: true; netPaid: number; previous: number | null } | { ok: false; error: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Database not configured" };

  let enr: Pick<CourseEnrollment, "id" | "total_fee" | "schedule" | "discount_amount" | "amount_paid"> | null =
    null;
  if (typeof enrollment === "string") {
    const { data, error } = await db
      .from("course_enrollments")
      .select("id,total_fee,schedule,discount_amount,amount_paid")
      .eq("id", enrollment)
      .maybeSingle();
    if (error || !data) return { ok: false, error: error?.message || "Enrollment not found" };
    enr = data as CourseEnrollment;
  } else {
    enr = enrollment;
  }

  const fee = enrollmentFeeStateFromEnrollment(enr);
  const netPaid = Math.round(fee.netPaid);
  const previous = enr.amount_paid == null ? null : Math.round(Number(enr.amount_paid) || 0);
  if (previous === netPaid) return { ok: true, netPaid, previous };

  const { error: upErr } = await db
    .from("course_enrollments")
    .update({ amount_paid: netPaid, updated_at: new Date().toISOString() })
    .eq("id", enr.id);
  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true, netPaid, previous };
}

/** Count enrollments where column ≠ fee-state netPaid. */
export async function countAmountPaidDrift(opts?: {
  limit?: number;
}): Promise<{ drift: number; checked: number; samples: AmountPaidDriftRow[] }> {
  const db = getSupabaseAdmin();
  if (!db) return { drift: 0, checked: 0, samples: [] };
  const pageSize = 500;
  const hardLimit = opts?.limit ?? 50_000;
  let offset = 0;
  let checked = 0;
  let drift = 0;
  const samples: AmountPaidDriftRow[] = [];

  while (checked < hardLimit) {
    const { data, error } = await db
      .from("course_enrollments")
      .select("id,student_name,phone,total_fee,schedule,discount_amount,amount_paid,status")
      .neq("status", "cancelled")
      .range(offset, offset + pageSize - 1);
    if (error) break;
    const rows = (data || []) as CourseEnrollment[];
    if (!rows.length) break;
    for (const e of rows) {
      checked++;
      const fee = enrollmentFeeStateFromEnrollment(e);
      const col = Math.round(Number(e.amount_paid) || 0);
      const fs = Math.round(fee.netPaid);
      if (col !== fs) {
        drift++;
        if (samples.length < 20) {
          samples.push({
            id: e.id,
            student_name: e.student_name,
            phone: e.phone,
            column: col,
            feeState: fs,
          });
        }
      }
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return { drift, checked, samples };
}

/** Resync all drifted amount_paid caches to fee-state. Returns remaining drift. */
export async function resyncAllAmountPaidCaches(opts?: {
  dryRun?: boolean;
  limit?: number;
}): Promise<{ before: number; fixed: number; after: number; checked: number }> {
  const dryRun = !!opts?.dryRun;
  const beforeScan = await countAmountPaidDrift(opts);
  if (dryRun || beforeScan.drift === 0) {
    return { before: beforeScan.drift, fixed: 0, after: beforeScan.drift, checked: beforeScan.checked };
  }

  const db = getSupabaseAdmin();
  if (!db) return { before: beforeScan.drift, fixed: 0, after: beforeScan.drift, checked: beforeScan.checked };

  const pageSize = 500;
  const hardLimit = opts?.limit ?? 50_000;
  let offset = 0;
  let checked = 0;
  let fixed = 0;

  while (checked < hardLimit) {
    const { data } = await db
      .from("course_enrollments")
      .select("id,total_fee,schedule,discount_amount,amount_paid,status")
      .neq("status", "cancelled")
      .range(offset, offset + pageSize - 1);
    const rows = (data || []) as CourseEnrollment[];
    if (!rows.length) break;
    for (const e of rows) {
      checked++;
      const fee = enrollmentFeeStateFromEnrollment(e);
      const col = Math.round(Number(e.amount_paid) || 0);
      const fs = Math.round(fee.netPaid);
      if (col === fs) continue;
      const { error } = await db
        .from("course_enrollments")
        .update({ amount_paid: fs, updated_at: new Date().toISOString() })
        .eq("id", e.id);
      if (!error) fixed++;
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  const afterScan = await countAmountPaidDrift(opts);
  return { before: beforeScan.drift, fixed, after: afterScan.drift, checked };
}
