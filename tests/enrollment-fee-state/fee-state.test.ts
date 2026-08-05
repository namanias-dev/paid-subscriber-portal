/**
 * Enrollment fee state — Simran-shaped partial + no-adhoc-sum guard.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  enrollmentFeeStateFromEnrollment,
  assertOrderAmountWithinOutstanding,
  isLinePartiallyPaid,
} from "../../lib/enrollmentFeeState";
import { deriveEnrollment, installmentStatus, isLineOutstanding } from "../../lib/installments";
import type { CourseEnrollment, InstallmentItem } from "../../lib/types";

/** Simran-like schedule: legacy ₹2k paid + Inst1 cancelled-with ₹18k paid_amount. */
function simranEnrollment(): CourseEnrollment {
  const schedule: InstallmentItem[] = [
    {
      no: 1,
      kind: "installment",
      label: "Legacy fee received (pre-portal)",
      amount: 2000,
      due: null,
      paid: true,
      status: "paid",
      paid_at: "2026-07-13T06:53:45.262Z",
    },
    {
      no: 2,
      kind: "installment",
      label: "Installment 1 of 3",
      amount: 19333,
      due: "2026-07-20T06:30:00.000Z",
      paid: false,
      status: "cancelled",
      paid_amount: 18000,
      payment_id: "f5094d7d-9566-47a6-8101-48e3df4f5a33",
      cancelled_reason: "Cancelled by admin",
    },
    {
      no: 3,
      kind: "installment",
      label: "Installment 2 of 3",
      amount: 19333,
      due: "2026-08-20T06:30:00.000Z",
      paid: false,
      status: "pending",
    },
    {
      no: 4,
      kind: "installment",
      label: "Installment 3 of 3",
      amount: 19334,
      due: "2026-09-20T06:30:00.000Z",
      paid: false,
      status: "pending",
    },
  ];
  return {
    id: "c5a9042c-d157-4afe-8c11-e71c92a5e036",
    phone: "9041285334",
    student_name: "Simran Chaudhary",
    email: null,
    course_id: "x",
    course_slug: "safalta",
    course_title: "Safalta GS Foundation (Offline Chandigarh)",
    batch_label: null,
    plan_type: "emi",
    total_fee: 60000,
    amount_paid: 2000, // stale column — fee state must ignore
    installment_count: 4,
    status: "partially_paid",
    schedule,
    created_at: "2026-07-13T00:00:00Z",
    updated_at: "2026-08-05T00:00:00Z",
    discount_amount: 15000,
  } as CourseEnrollment;
}

describe("enrollmentFeeState — Simran partial", () => {
  it("reads ₹20,000 paid / ₹40,000 outstanding / 33% / next Inst 2", () => {
    const fee = enrollmentFeeStateFromEnrollment(simranEnrollment());
    assert.equal(fee.netPaid, 20000);
    assert.equal(fee.outstanding, 40000);
    assert.equal(fee.payFullRemainingAmount, 40000);
    assert.equal(fee.progressPct, 33);
    assert.equal(fee.legacyPaid, 2000);
    assert.ok(fee.nextDueInstalment);
    assert.equal(fee.nextDueInstalment!.n, 3);
    assert.equal(fee.nextDueInstalment!.amountDue, 19333);
    assert.match(fee.nextDueInstalment!.label, /Installment 2/);
  });

  it("surfaces Instalment 1 as partially_paid with ₹1,333 remaining (not hidden)", () => {
    const fee = enrollmentFeeStateFromEnrollment(simranEnrollment());
    const inst1 = fee.instalments.find((l) => l.no === 2);
    assert.ok(inst1);
    assert.equal(inst1!.status, "partially_paid");
    assert.equal(inst1!.allocated, 18000);
    assert.equal(inst1!.remaining, 1333);
    assert.equal(inst1!.hidden, false);
    assert.equal(isLinePartiallyPaid(simranEnrollment().schedule[1]!), true);
    assert.equal(isLineOutstanding(simranEnrollment().schedule[1]!), false);
    assert.equal(installmentStatus(simranEnrollment().schedule[1]!), "partially_paid");
  });

  it("deriveEnrollment adapter matches fee state", () => {
    const e = simranEnrollment();
    const d = deriveEnrollment(e);
    assert.equal(d.paid, 20000);
    assert.equal(d.remaining, 40000);
    assert.equal(d.nextPayable?.no, 3);
    assert.equal(d.nextPayable?.amount, 19333);
  });

  it("rejects order amount above outstanding", () => {
    const bad = assertOrderAmountWithinOutstanding(58000, 40000);
    assert.equal(bad.ok, false);
    const ok = assertOrderAmountWithinOutstanding(40000, 40000);
    assert.equal(ok.ok, true);
  });
});

describe("no ad-hoc fee sums guard", () => {
  it("keeps enrollmentFeeState as the documented source of truth", () => {
    const root = join(process.cwd(), "lib");
    const hits: string[] = [];
    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === "node_modules") continue;
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        if (p.endsWith("enrollmentFeeState.ts") || p.endsWith("installments.ts")) continue;
        const text = readFileSync(p, "utf8");
        // Flag bare total_fee - amount_paid for outstanding (common drift).
        if (/total_fee\s*\|\|\s*0\)\s*-\s*\(/.test(text) || /total_fee\s*-\s*.*amount_paid/.test(text)) {
          // Allow known thin wrappers that delegate or document exception
          if (text.includes("enrollmentFeeStateFromEnrollment") || text.includes("FEE STATE")) continue;
          if (p.includes("accessAtRisk.ts")) continue; // has schedule branch + fallback
          if (p.includes("studentTimeline.ts")) continue; // historical fee-change rows
          if (p.includes("enrollmentTransfer.ts")) continue; // transfer copy uses carried amount_paid intentionally
          hits.push(p.replace(process.cwd() + "/", ""));
        }
      }
    }
    walk(root);
    assert.deepEqual(hits, [], `Ad-hoc outstanding formulas:\n${hits.join("\n")}`);
  });
});
