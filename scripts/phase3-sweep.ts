/**
 * Phase 3 sweep — scan all enrollments for partial/carry gaps + surface drift.
 * If 0–3 hits: apply Simran-style carry-forward (--write).
 * If >3: print list and exit without writes.
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/phase3-sweep.ts
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/phase3-sweep.ts --write
 */
import { readFileSync, existsSync } from "fs";
import {
  getAllCourseEnrollments,
  updateCourseEnrollment,
  addEnrollmentPlanChangeLog,
  findStudentByPhone,
} from "../lib/dataProvider";
import { enrollmentFeeStateFromEnrollment, isLinePartiallyPaid, lineAllocatedAmount } from "../lib/enrollmentFeeState";
import { planCarryForwardIdempotent } from "../lib/partialSettlement";
import { syncAmountPaidFromFeeState } from "../lib/amountPaidCache";
import { enrollmentStatusFromSchedule, isActiveEnrollment } from "../lib/installments";
import { getSupabaseAdmin } from "../lib/supabase";
import type { CourseEnrollment } from "../lib/types";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1]!.trim();
    let v = m[2]!.trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

type Hit = {
  id: string;
  name: string;
  phone: string;
  reasons: string[];
  fromNo: number | null;
  shortfall: number | null;
};

function scanEnrollment(e: CourseEnrollment): Hit | null {
  if (!isActiveEnrollment(e) && e.status === "cancelled") return null;
  if (e.status === "cancelled" || e.status === "transferred_out") return null;

  const reasons: string[] = [];
  const fee = enrollmentFeeStateFromEnrollment(e);
  const col = Math.round(Number(e.amount_paid) || 0);
  const fsPaid = Math.round(fee.netPaid);
  const fsOut = Math.round(fee.outstanding);
  const naiveOut = Math.max(0, Math.round(Number(e.total_fee) || 0) - col);

  if (col !== fsPaid) reasons.push(`amount_paid_drift col=${col} fee=${fsPaid}`);
  if (naiveOut !== fsOut && col !== fsPaid) {
    // only flag surface disagreement when column drives naive math differently
    reasons.push(`surface_disagree naiveOut=${naiveOut} feeOut=${fsOut}`);
  }

  // pay-full must equal outstanding
  if (fee.payFullRemainingAmount !== fee.outstanding) {
    reasons.push(`pay_full_ne_outstanding ${fee.payFullRemainingAmount}≠${fee.outstanding}`);
  }
  if (fee.payFullRemainingAmount > fee.outstanding) {
    reasons.push(`pay_full_exceeds_outstanding`);
  }
  if (fee.netPaid > fee.totalFee) reasons.push(`netPaid_gt_totalFee`);
  if (fee.outstanding < 0) reasons.push(`negative_outstanding`);

  // Partial without carry: allocated < amount, remaining > 0, no carried_out
  let fromNo: number | null = null;
  let shortfall: number | null = null;
  for (const line of e.schedule || []) {
    if (line.kind !== "installment") continue;
    if (/legacy|pre-portal/i.test(line.label || "")) continue;
    if (!isLinePartiallyPaid(line) && !(lineAllocatedAmount(line) > 0 && !line.paid)) continue;
    const alloc = lineAllocatedAmount(line);
    const amt = Math.round(Number(line.amount) || 0);
    const carriedOut = Math.round(Number(line.carried_out) || 0);
    if (alloc > 0 && alloc < amt && carriedOut <= 0) {
      reasons.push(`partial_no_carry no=${line.no} alloc=${alloc} amt=${amt} rem=${amt - alloc}`);
      if (fromNo == null) {
        fromNo = line.no;
        shortfall = amt - alloc;
      }
    }
  }

  // Approved proof ≠ line amount without carry (best-effort via paid_amount already covered)

  if (!reasons.length) return null;
  return {
    id: e.id,
    name: e.student_name,
    phone: e.phone,
    reasons,
    fromNo,
    shortfall,
  };
}

async function applyCarry(e: CourseEnrollment, fromNo: number) {
  const before = enrollmentFeeStateFromEnrollment(e);
  const plan = planCarryForwardIdempotent({ enrollment: e, fromNo });
  if (!plan.ok) return { ok: false as const, error: plan.error, before, after: null };
  if (plan.alreadyApplied) {
    return { ok: true as const, skipped: true, before, after: before, plan };
  }
  const now = new Date().toISOString();
  const status = enrollmentStatusFromSchedule({
    total_fee: e.total_fee,
    schedule: plan.scheduleAfter,
    plan_type: e.plan_type,
  });
  const updated = await updateCourseEnrollment(e.id, {
    schedule: plan.scheduleAfter,
    status,
    payment_plan_changed_at: now,
    payment_plan_changed_by: "admin",
    payment_plan_change_reason: `Phase 3 carry-forward: Inst ${fromNo} shortfall carried`,
  });
  await syncAmountPaidFromFeeState({ ...(updated || e), schedule: plan.scheduleAfter });
  const afterEnr = { ...(updated || e), schedule: plan.scheduleAfter };
  const after = enrollmentFeeStateFromEnrollment(afterEnr);
  const student = await findStudentByPhone(e.phone).catch(() => null);
  await addEnrollmentPlanChangeLog({
    enrollment_id: e.id,
    student_id: student?.id ?? null,
    phone: e.phone,
    course_id: e.course_id,
    old_plan: e.payment_plan || e.plan_type || "emi",
    new_plan: e.payment_plan || e.plan_type || "emi",
    old_outstanding: before.outstanding,
    new_outstanding: after.outstanding,
    reason: `Phase 3 carry-forward Inst ${fromNo}`,
    changed_by: "admin",
    metadata: {
      type: "phase3_partial_carry",
      before: { netPaid: before.netPaid, outstanding: before.outstanding, next: before.nextDueInstalment },
      after: { netPaid: after.netPaid, outstanding: after.outstanding, next: after.nextDueInstalment },
      carriedOut: plan.carriedOut,
      toNo: plan.toNo,
    },
  }).catch(() => null);

  const db = getSupabaseAdmin();
  if (db) {
    await db.from("installment_allocation_audit").insert({
      enrollment_id: e.id,
      student_name: e.student_name,
      phone: e.phone,
      amount_paid_before: e.amount_paid,
      amount_paid_after: after.netPaid,
      paid_sum_before: before.netPaid,
      paid_sum_after: after.netPaid,
      schedule_before: e.schedule,
      schedule_after: plan.scheduleAfter,
      lock_before: null,
      lock_after: null,
      applied_by: "admin",
      note: "phase3_carry",
    });
  }
  return { ok: true as const, skipped: false, before, after, plan };
}

async function main() {
  const write = process.argv.includes("--write");
  const all = await getAllCourseEnrollments();
  const active = all.filter((e) => e.status !== "cancelled" && e.status !== "transferred_out");
  console.log("SCANNED", active.length);

  const hits: Hit[] = [];
  for (const e of active) {
    const h = scanEnrollment(e);
    if (h) hits.push(h);
  }

  // Drift-only without partial may already be healed by cache sync — still list
  console.log("HIT_COUNT", hits.length);
  console.log(
    "HITS",
    JSON.stringify(
      hits.map((h) => ({
        id: h.id,
        name: h.name,
        phone: h.phone,
        reasons: h.reasons,
        fromNo: h.fromNo,
        shortfall: h.shortfall,
      })),
      null,
      2,
    ),
  );

  if (hits.length > 3) {
    console.log("ACTION", "abort_gt3_no_write");
    process.exit(2);
  }

  if (hits.length === 0) {
    console.log("ACTION", "none_clean");
    return;
  }

  // Only write carry for hits that have a fromNo (partial_no_carry). Drift-only → sync cache.
  if (!write) {
    console.log("ACTION", "dry_would_fix", hits.length);
    return;
  }

  for (const h of hits) {
    const e = all.find((x) => x.id === h.id);
    if (!e) continue;
    if (h.fromNo != null) {
      const res = await applyCarry(e, h.fromNo);
      console.log(
        "FIX_CARRY",
        JSON.stringify({
          id: h.id,
          name: h.name,
          ok: res.ok,
          error: res.ok ? undefined : res.error,
          skipped: res.ok ? res.skipped : undefined,
          before: res.before
            ? { paid: res.before.netPaid, out: res.before.outstanding, next: res.before.nextDueInstalment }
            : null,
          after: res.after
            ? { paid: res.after.netPaid, out: res.after.outstanding, next: res.after.nextDueInstalment }
            : null,
        }),
      );
    } else if (h.reasons.some((r) => r.startsWith("amount_paid_drift"))) {
      const sync = await syncAmountPaidFromFeeState(e);
      const after = enrollmentFeeStateFromEnrollment(
        (await getAllCourseEnrollments()).find((x) => x.id === e.id) || e,
      );
      console.log(
        "FIX_DRIFT",
        JSON.stringify({
          id: h.id,
          name: h.name,
          sync,
          after: { paid: after.netPaid, out: after.outstanding },
        }),
      );
    } else {
      console.log("SKIP_NO_FIX", h.id, h.reasons);
    }
  }
  console.log("ACTION", "wrote", hits.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
