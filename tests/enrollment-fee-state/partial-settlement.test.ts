/**
 * Fixture: partial settlement idempotency + reversal; waived + lifetime-access render.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrollmentFeeStateFromEnrollment } from "../../lib/enrollmentFeeState";
import {
  planCarryForward,
  planCarryForwardIdempotent,
  reverseCarryForward,
  recommendPartialAccept,
} from "../../lib/partialSettlement";
import type { CourseEnrollment, InstallmentItem } from "../../lib/types";

function baseEnrollment(schedule: InstallmentItem[]): CourseEnrollment {
  return {
    id: "fixture-partial-1",
    phone: "9000000001",
    student_name: "Fixture Student",
    email: null,
    course_id: "c",
    course_slug: "c",
    course_title: "Fixture Course",
    batch_label: null,
    plan_type: "emi",
    total_fee: 60000,
    amount_paid: 2000,
    installment_count: 4,
    status: "partially_paid",
    schedule,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-08-05T00:00:00Z",
    discount_amount: 0,
  } as CourseEnrollment;
}

function simranLikeSchedule(): InstallmentItem[] {
  return [
    {
      no: 1,
      kind: "installment",
      label: "Legacy fee received (pre-portal)",
      amount: 2000,
      due: null,
      paid: true,
      status: "paid",
    },
    {
      no: 2,
      kind: "installment",
      label: "Installment 1 of 3",
      amount: 19333,
      due: "2026-07-20T06:30:00.000Z",
      paid: false,
      status: "partially_paid",
      paid_amount: 18000,
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
}

describe("partial settlement fixture", () => {
  it("double apply → one allocation (idempotent)", () => {
    const enr = baseEnrollment(simranLikeSchedule());
    const first = planCarryForward({ enrollment: enr, fromNo: 2 });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.carriedOut, 1333);
    assert.equal(first.nextAmountDue, 20666);
    const raw2 = first.scheduleAfter.find((l) => l.no === 3)!;
    assert.equal(raw2.amount, 19333); // never overwrite

    const second = planCarryForwardIdempotent({
      enrollment: { ...enr, schedule: first.scheduleAfter },
      fromNo: 2,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.alreadyApplied, true);
    assert.equal(second.carriedOut, 1333);
    const fee = enrollmentFeeStateFromEnrollment({ ...enr, schedule: first.scheduleAfter });
    assert.equal(fee.netPaid, 20000);
    assert.equal(fee.outstanding, 40000);
    assert.equal(fee.progressPct, 33);
    assert.equal(fee.nextDueInstalment?.amountDue, 20666);
  });

  it("reversal → exact prior state; re-apply → correct", () => {
    const enr = baseEnrollment(simranLikeSchedule());
    const applied = planCarryForward({ enrollment: enr, fromNo: 2 });
    assert.ok(applied.ok);
    if (!applied.ok) return;
    const reversed = reverseCarryForward({
      enrollment: { ...enr, schedule: applied.scheduleAfter },
      fromNo: 2,
    });
    assert.ok(reversed.ok);
    if (!reversed.ok) return;
    const from = reversed.scheduleAfter.find((l) => l.no === 2)!;
    const to = reversed.scheduleAfter.find((l) => l.no === 3)!;
    assert.equal(from.carried_out || 0, 0);
    assert.equal(to.carried_in || 0, 0);
    assert.equal(to.amount, 19333);
    const fee = enrollmentFeeStateFromEnrollment({ ...enr, schedule: reversed.scheduleAfter });
    assert.equal(fee.instalments.find((l) => l.no === 2)?.remaining, 1333);

    const re = planCarryForward({ enrollment: { ...enr, schedule: reversed.scheduleAfter }, fromNo: 2 });
    assert.ok(re.ok);
    if (!re.ok) return;
    assert.equal(re.nextAmountDue, 20666);
  });

  it("waived line renders remaining 0 and is skipped", () => {
    const schedule = simranLikeSchedule();
    schedule[2] = { ...schedule[2]!, status: "waived", paid: false, amount: 19333 };
    const fee = enrollmentFeeStateFromEnrollment(baseEnrollment(schedule));
    const w = fee.instalments.find((l) => l.no === 3)!;
    assert.equal(w.status, "waived");
    assert.equal(w.remaining, 0);
    assert.equal(fee.nextDueInstalment?.n, 4);
  });

  it("lifetime-access fully_paid fixture has 0 outstanding", () => {
    const schedule: InstallmentItem[] = [
      {
        no: 0,
        kind: "full",
        label: "Lifetime access",
        amount: 50000,
        due: null,
        paid: true,
        status: "paid",
      },
    ];
    const enr = baseEnrollment(schedule);
    enr.total_fee = 50000;
    enr.plan_type = "full";
    enr.status = "fully_paid";
    const fee = enrollmentFeeStateFromEnrollment(enr);
    assert.equal(fee.outstanding, 0);
    assert.equal(fee.isFullyPaid, true);
    assert.equal(fee.nextDueInstalment, null);
  });

  it("recommend threshold default ≥75% is recommendation only", () => {
    const low = recommendPartialAccept({ lineAmount: 10000, amountReceived: 7000 });
    assert.equal(low.recommend, false);
    const high = recommendPartialAccept({ lineAmount: 10000, amountReceived: 7500 });
    assert.equal(high.recommend, true);
    assert.equal(high.thresholdPct, 75);
  });
});
