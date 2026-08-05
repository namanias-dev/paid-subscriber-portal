/**
 * Dry-run helpers for Phase 1.5 verification — transfer outstanding + ladder %.
 * No writes / no SMS.
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/phase15-simran-verify.ts
 */
import { readFileSync, existsSync } from "fs";
import { getCourseEnrollmentById, getAllCourses } from "../lib/dataProvider";
import { enrollmentFeeStateFromEnrollment } from "../lib/enrollmentFeeState";
import { planTransfer } from "../lib/enrollmentTransfer";
import { evaluateEnrollmentForBackfill } from "../lib/sms/installmentLadder";

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

async function main() {
  const enr = await getCourseEnrollmentById(ENROLLMENT_ID);
  if (!enr) throw new Error("missing enrollment");
  const fee = enrollmentFeeStateFromEnrollment(enr);
  console.log("FEE_STATE", {
    netPaid: fee.netPaid,
    outstanding: fee.outstanding,
    progressPct: fee.progressPct,
    next: fee.nextDueInstalment,
  });

  // Ladder before (column-style) vs after (fee-state) — print both, send nothing.
  const columnPct = enr.total_fee > 0 ? Math.round((100 * (enr.amount_paid || 0)) / enr.total_fee) : 0;
  console.log("LADDER_PCT_BEFORE_COLUMN", columnPct);
  console.log("LADDER_PCT_AFTER_FEE_STATE", fee.progressPct);

  const courses = await getAllCourses();
  const course = courses.find((c) => c.id === enr.course_id);
  if (course) {
    const cand = evaluateEnrollmentForBackfill({
      enrollment: enr,
      course,
      loginCode: null,
      lastContactAt: null,
      excludeReason: null,
    });
    console.log("LADDER_WOULD_MESSAGE", cand?.proposedMessage || "(none — not overdue on next open line)");
    console.log("LADDER_CHANNEL", cand?.proposedChannel || "none");
  }

  // Transfer dry-run to a scratch target (same course first other batch, or same batch).
  const sourceCourse = course || null;
  const batches = sourceCourse?.batches || [];
  const targetBatchId =
    batches.find((b) => b.id !== enr.batch_id)?.id || batches[0]?.id || enr.batch_id;
  if (sourceCourse && targetBatchId) {
    const plan = planTransfer({
      enrollment: enr,
      sourceCourse,
      targetCourse: sourceCourse,
      targetBatchId: String(targetBatchId),
    });
    console.log("TRANSFER_DRY_RUN", {
      amountPaid: plan.money.amountPaid,
      oldOutstanding: plan.money.oldOutstanding,
      newOutstanding: plan.money.newOutstanding,
      oldTotal: plan.money.oldTotal,
      newTotal: plan.money.newTotal,
    });
    console.log("TRANSFER_OUTSTANDING_FIGURE", plan.money.oldOutstanding);
  } else {
    console.log("TRANSFER_DRY_RUN skipped — no batch");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
