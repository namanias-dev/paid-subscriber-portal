/**
 * Phase 2 — Simran carry-forward write (c5a9042c / 9041285334).
 * Dry-run first; write only if dry-run matches pre-authorised end state exactly.
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/phase2-simran-carry.ts
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/phase2-simran-carry.ts --write
 */
import { readFileSync, existsSync } from "fs";
import { getCourseEnrollmentById, updateCourseEnrollment, addEnrollmentPlanChangeLog, findStudentByPhone } from "../lib/dataProvider";
import { enrollmentFeeStateFromEnrollment } from "../lib/enrollmentFeeState";
import { planCarryForwardIdempotent } from "../lib/partialSettlement";
import { syncAmountPaidFromFeeState } from "../lib/amountPaidCache";
import { enrollmentStatusFromSchedule } from "../lib/installments";
import { getSupabaseAdmin } from "../lib/supabase";

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

const ENROLLMENT_ID = "c5a9042c-d157-4afe-8c11-e71c92a5e036";
const PHONE = "9041285334";
const FROM_NO = 2; // Installment 1 of 3

const EXPECTED = {
  netPaid: 20000,
  outstanding: 40000,
  progressPct: 33,
  inst1: { allocated: 18000, carriedOut: 1333, remaining: 0, status: "partially_paid" },
  inst2: { base: 19333, carriedIn: 1333, amountDue: 20666 },
  inst3: { base: 19334 },
  payFull: 40000,
};

function snapshot(enr: Awaited<ReturnType<typeof getCourseEnrollmentById>>) {
  if (!enr) return null;
  const fee = enrollmentFeeStateFromEnrollment(enr);
  const i1 = fee.instalments.find((l) => l.no === 2);
  const i2 = fee.instalments.find((l) => l.no === 3);
  const i3 = fee.instalments.find((l) => l.no === 4);
  const raw2 = (enr.schedule || []).find((l) => l.no === 3);
  return {
    netPaid: fee.netPaid,
    outstanding: fee.outstanding,
    progressPct: fee.progressPct,
    payFull: fee.payFullRemainingAmount,
    next: fee.nextDueInstalment,
    inst1: i1
      ? {
          allocated: i1.allocated,
          carriedOut: i1.carriedOut,
          remaining: i1.remaining,
          status: i1.status,
        }
      : null,
    inst2: i2
      ? {
          base: i2.original,
          carriedIn: i2.carriedIn,
          amountDue: i2.remaining,
          amountField: raw2?.amount,
          due: i2.dueDate,
        }
      : null,
    inst3: i3 ? { base: i3.original, carriedIn: i3.carriedIn } : null,
  };
}

function matchesExpected(s: NonNullable<ReturnType<typeof snapshot>>): string[] {
  const errs: string[] = [];
  if (s.netPaid !== EXPECTED.netPaid) errs.push(`netPaid ${s.netPaid}≠${EXPECTED.netPaid}`);
  if (s.outstanding !== EXPECTED.outstanding) errs.push(`outstanding ${s.outstanding}≠${EXPECTED.outstanding}`);
  if (s.progressPct !== EXPECTED.progressPct) errs.push(`progressPct ${s.progressPct}≠${EXPECTED.progressPct}`);
  if (s.payFull !== EXPECTED.payFull) errs.push(`payFull ${s.payFull}≠${EXPECTED.payFull}`);
  if (!s.inst1 || s.inst1.allocated !== EXPECTED.inst1.allocated) errs.push("inst1 allocated");
  if (!s.inst1 || s.inst1.carriedOut !== EXPECTED.inst1.carriedOut) errs.push("inst1 carriedOut");
  if (!s.inst1 || s.inst1.remaining !== EXPECTED.inst1.remaining) errs.push("inst1 remaining");
  if (!s.inst1 || s.inst1.status !== EXPECTED.inst1.status) errs.push("inst1 status");
  if (!s.inst2 || s.inst2.base !== EXPECTED.inst2.base) errs.push("inst2 base");
  if (!s.inst2 || s.inst2.carriedIn !== EXPECTED.inst2.carriedIn) errs.push("inst2 carriedIn");
  if (!s.inst2 || s.inst2.amountDue !== EXPECTED.inst2.amountDue) errs.push("inst2 amountDue");
  if (!s.inst2 || s.inst2.amountField !== EXPECTED.inst2.base) errs.push("inst2 amount field mutated");
  if (!s.inst3 || s.inst3.base !== EXPECTED.inst3.base) errs.push("inst3 base");
  if (s.next?.amountDue !== EXPECTED.inst2.amountDue) errs.push("next amountDue");
  return errs;
}

async function main() {
  const write = process.argv.includes("--write");
  const enr = await getCourseEnrollmentById(ENROLLMENT_ID);
  if (!enr || enr.phone.replace(/\D/g, "").slice(-10) !== PHONE) {
    console.error("ABORT: enrollment/phone mismatch");
    process.exit(1);
  }

  console.log("BEFORE", JSON.stringify(snapshot(enr), null, 2));

  const plan = planCarryForwardIdempotent({ enrollment: enr, fromNo: FROM_NO });
  if (!plan.ok) {
    console.error("ABORT plan", plan.error);
    process.exit(1);
  }

  const dryEnr = { ...enr, schedule: plan.scheduleAfter };
  const drySnap = snapshot(dryEnr)!;
  console.log("DRY_RUN", JSON.stringify(drySnap, null, 2));
  const errs = matchesExpected(drySnap);
  if (errs.length) {
    console.error("ABORT: dry-run ≠ pre-authorised end state:", errs.join(", "));
    process.exit(1);
  }
  console.log("DRY_RUN_MATCHES_EXPECTED ok");

  if (!write) {
    console.log("No --write flag — exiting without DB write");
    return;
  }

  const now = new Date().toISOString();
  const status = enrollmentStatusFromSchedule({
    total_fee: enr.total_fee,
    schedule: plan.scheduleAfter,
    plan_type: enr.plan_type,
  });
  const updated = await updateCourseEnrollment(enr.id, {
    schedule: plan.scheduleAfter,
    status,
    payment_plan_changed_at: now,
    payment_plan_changed_by: "admin",
    payment_plan_change_reason: "Phase 2 partial settlement: Inst1 shortfall ₹1,333 carried to Inst2",
  });
  await syncAmountPaidFromFeeState({ ...(updated || enr), schedule: plan.scheduleAfter });

  const student = await findStudentByPhone(PHONE).catch(() => null);
  await addEnrollmentPlanChangeLog({
    enrollment_id: enr.id,
    student_id: student?.id ?? null,
    phone: enr.phone,
    course_id: enr.course_id,
    old_plan: enr.payment_plan || enr.plan_type || "emi",
    new_plan: enr.payment_plan || enr.plan_type || "emi",
    old_outstanding: 40000,
    new_outstanding: 40000,
    reason: "Phase 2 carry-forward (Simran): Inst1 partially_paid + ₹1333 carried_in on Inst2",
    changed_by: "admin",
    metadata: {
      type: "partial_carry_forward",
      before: snapshot(enr),
      after: drySnap,
      approver: "admin",
      at: now,
    },
  }).catch(() => null);

  const db = getSupabaseAdmin();
  if (db) {
    await db.from("installment_allocation_audit").insert({
      enrollment_id: enr.id,
      student_name: enr.student_name,
      phone: enr.phone,
      amount_paid_before: enr.amount_paid,
      amount_paid_after: EXPECTED.netPaid,
      paid_sum_before: enr.amount_paid,
      paid_sum_after: EXPECTED.netPaid,
      schedule_before: enr.schedule,
      schedule_after: plan.scheduleAfter,
      lock_before: null,
      lock_after: null,
      applied_by: "admin",
      note: "phase2_simran_carry",
    });
  }

  const after = await getCourseEnrollmentById(ENROLLMENT_ID);
  const afterSnap = snapshot(after)!;
  console.log("AFTER", JSON.stringify(afterSnap, null, 2));
  const afterErrs = matchesExpected(afterSnap);
  if (afterErrs.length) {
    console.error("FAIL post-write:", afterErrs.join(", "));
    process.exit(1);
  }
  console.log("POST_WRITE_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
