/**
 * Retrospective oldest-outstanding-first instalment reallocation.
 *
 * Dry-run by default. Pass --apply to write. Aborts if any enrollment's
 * paid-sum or amount_paid would move by even ₹1.
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/reallocate-oldest-first.ts
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/reallocate-oldest-first.ts --apply
 */
import { createClient } from "@supabase/supabase-js";
import {
  assertAllocationTotalsUnchanged,
  reallocateScheduleOldestFirst,
} from "../lib/installmentAllocation";
import { deriveEnrollment, enrollmentStatusFromSchedule } from "../lib/installments";
import type { CourseEnrollment, InstallmentItem } from "../lib/types";

const APPLY = process.argv.includes("--apply");
const GRACE_DAYS = 15;
const DAY_MS = 86_400_000;

function loadEnv() {
  const fs = require("fs") as typeof import("fs");
  const path = ".env.local";
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}

function earliestUnpaidDue(schedule: InstallmentItem[]): number | null {
  let best: number | null = null;
  for (const s of schedule) {
    if (s.paid || s.status === "cancelled" || s.status === "waived") continue;
    if (!s.due) continue;
    const t = Date.parse(s.due);
    if (!Number.isFinite(t)) continue;
    if (best == null || t < best) best = t;
  }
  return best;
}

function isLocked(schedule: InstallmentItem[], now = Date.now()): boolean {
  const due = earliestUnpaidDue(schedule);
  if (due == null) return false;
  return now > due + GRACE_DAYS * DAY_MS;
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: enrs, error } = await sb
    .from("course_enrollments")
    .select("id,student_name,phone,course_title,total_fee,amount_paid,status,schedule,plan_type")
    .neq("status", "cancelled")
    .neq("status", "transferred_out")
    .gt("amount_paid", 0);
  if (error) throw error;

  const changed: Array<{
    e: CourseEnrollment;
    before: ReturnType<typeof reallocateScheduleOldestFirst>;
    lockBefore: boolean;
    lockAfter: boolean;
  }> = [];

  for (const raw of enrs || []) {
    const e = raw as CourseEnrollment;
    const result = reallocateScheduleOldestFirst(e.schedule || []);
    if (!result.changed) continue;

    const check = assertAllocationTotalsUnchanged(
      result.paidSumBefore,
      result.paidSumAfter,
      e.amount_paid || 0,
      e.amount_paid || 0, // amount_paid column unchanged; derived must match
    );
    const derivedAfter = deriveEnrollment({ total_fee: e.total_fee, schedule: result.schedule });
    if (Math.round(derivedAfter.paid) !== Math.round(e.amount_paid || 0)) {
      console.error("ABORT amount_paid drift", e.id, e.student_name, e.amount_paid, derivedAfter.paid);
      process.exit(1);
    }
    if (!check.ok) {
      console.error("ABORT", e.id, check.error);
      process.exit(1);
    }

    changed.push({
      e,
      before: result,
      lockBefore: isLocked(e.schedule || []),
      lockAfter: isLocked(result.schedule),
    });
  }

  console.log(`mode=${APPLY ? "APPLY" : "DRY-RUN"} candidates=${changed.length}`);
  for (const c of changed) {
    const paidNos = (s: InstallmentItem[]) =>
      s.filter((x) => x.paid).map((x) => x.no).join(",");
    const unpaidNos = (s: InstallmentItem[]) =>
      s.filter((x) => !x.paid && x.status !== "cancelled" && x.status !== "waived").map((x) => x.no).join(",");
    console.log(
      `${c.e.student_name} ${c.e.id.slice(0, 8)} paid=${c.e.amount_paid}/${c.e.total_fee}` +
        ` before paid=[${paidNos(c.e.schedule || [])}] unpaid=[${unpaidNos(c.e.schedule || [])}]` +
        ` after paid=[${paidNos(c.before.schedule)}] unpaid=[${unpaidNos(c.before.schedule)}]` +
        ` lock ${c.lockBefore}→${c.lockAfter}`,
    );
  }

  if (!APPLY) {
    console.log("Re-run with --apply to write.");
    return;
  }

  for (const c of changed) {
    const derived = deriveEnrollment({ total_fee: c.e.total_fee, schedule: c.before.schedule });
    const status = enrollmentStatusFromSchedule({
      total_fee: c.e.total_fee,
      schedule: c.before.schedule,
      plan_type: c.e.plan_type,
    });
    if (Math.round(derived.paid) !== Math.round(c.e.amount_paid || 0)) {
      console.error("ABORT pre-write", c.e.id);
      process.exit(1);
    }
    const { error: upErr } = await sb
      .from("course_enrollments")
      .update({
        schedule: c.before.schedule,
        // amount_paid intentionally unchanged
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", c.e.id);
    if (upErr) {
      console.error("update failed", c.e.id, upErr);
      process.exit(1);
    }
    await sb.from("installment_allocation_audit").insert({
      enrollment_id: c.e.id,
      student_name: c.e.student_name,
      phone: c.e.phone,
      amount_paid_before: c.e.amount_paid,
      amount_paid_after: c.e.amount_paid,
      paid_sum_before: c.before.paidSumBefore,
      paid_sum_after: c.before.paidSumAfter,
      schedule_before: c.before.before,
      schedule_after: c.before.after,
      lock_before: c.lockBefore,
      lock_after: c.lockAfter,
      applied_by: "reallocate-oldest-first.ts",
      note: "Phase A oldest-outstanding-first retrospective",
    });
  }
  console.log(`applied=${changed.length} totals_assertion=passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
