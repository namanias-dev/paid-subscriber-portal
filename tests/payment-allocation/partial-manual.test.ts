/**
 * Partial manual payments allocate rupees received, not the installment face.
 * ₹10,000 against a ₹25,000 line is ₹10,000 paid.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveEnrollment, isLineOutstanding } from "../../lib/installments";
import { lineRemainingAmount } from "../../lib/enrollmentFeeState";
import {
  allocatePaymentOntoSchedule,
  capOfflineAmount,
  manualAllocationSentences,
  previewOfflineAllocation,
  replayPaymentsOntoSchedule,
} from "../../lib/schedulePaymentAllocation";
import { resolveInstallmentForEnrollment } from "../../lib/sms/installmentReminder";
import type { CourseEnrollment, InstallmentItem } from "../../lib/types";

function line(no: number, amount: number, extra: Partial<InstallmentItem> = {}): InstallmentItem {
  return {
    no,
    kind: "installment",
    label: `Installment ${no}`,
    amount,
    due: `2026-11-${String(no).padStart(2, "0")}T06:30:00.000Z`,
    paid: false,
    ...extra,
  };
}

function paidTotal(schedule: InstallmentItem[], total = 75000): number {
  return deriveEnrollment({ total_fee: total, schedule }).paid;
}

function pay(amount: number, ref: string, source = "admin_offline") {
  return {
    amount,
    payment_kind: "installment" as const,
    reference_no: ref,
    id: ref,
    payment_source: source,
  };
}

describe("a payment smaller than the installment does not pay the whole line", () => {
  test("TEST 1 ₹10,000 against ₹25,000 leaves ₹15,000 and totals ₹10,000", () => {
    const before = [line(1, 25000), line(2, 25000), line(3, 25000)];
    const { schedule, paymentLabel } = allocatePaymentOntoSchedule(before, pay(10000, "OFF-A"));
    const first = schedule[0]!;
    assert.equal(first.amount, 25000);
    assert.equal(first.paid, false);
    assert.equal(first.status, "partially_paid");
    assert.equal(first.paid_amount, 10000);
    assert.equal(lineRemainingAmount(first), 15000);
    assert.equal(paidTotal(schedule), 10000);
    assert.equal(schedule[1]!.paid, false);
    assert.equal(schedule[1]!.paid_amount ?? null, null);
    assert.match(paymentLabel, /partial/);
    assert.equal(isLineOutstanding(first), true);
  });

  test("TEST 2 a further ₹5,000 stays on the same line", () => {
    let schedule = allocatePaymentOntoSchedule([line(1, 25000), line(2, 25000)], pay(10000, "OFF-A")).schedule;
    schedule = allocatePaymentOntoSchedule(schedule, pay(5000, "OFF-B")).schedule;
    assert.equal(schedule[0]!.paid_amount, 15000);
    assert.equal(schedule[0]!.paid, false);
    assert.equal(lineRemainingAmount(schedule[0]!), 10000);
    assert.equal(schedule[0]!.amount, 25000);
    assert.equal(schedule[1]!.paid, false);
    assert.equal(paidTotal(schedule, 50000), 15000);
  });

  test("TEST 3 the final ₹10,000 closes the line at exactly ₹25,000", () => {
    let schedule = [line(1, 25000)];
    schedule = allocatePaymentOntoSchedule(schedule, pay(10000, "OFF-A")).schedule;
    schedule = allocatePaymentOntoSchedule(schedule, pay(5000, "OFF-B")).schedule;
    schedule = allocatePaymentOntoSchedule(schedule, pay(10000, "OFF-C")).schedule;
    assert.equal(schedule[0]!.paid, true);
    assert.equal(schedule[0]!.amount, 25000);
    assert.equal(lineRemainingAmount(schedule[0]!), 0);
    assert.equal(paidTotal(schedule, 25000), 25000);
  });

  test("TEST 4 a payment equal to the installment closes it once", () => {
    const { schedule } = allocatePaymentOntoSchedule([line(1, 25000), line(2, 25000)], pay(25000, "OFF-FULL"));
    assert.equal(schedule[0]!.paid, true);
    assert.equal(schedule[0]!.amount, 25000);
    assert.equal(schedule[1]!.paid, false);
    assert.equal(paidTotal(schedule, 50000), 25000);
  });

  test("TEST 5 ₹20,000 fills a ₹10,000 remainder and puts ₹10,000 on the next line", () => {
    const start = [
      line(1, 25000, { paid_amount: 15000, status: "partially_paid" }),
      line(2, 25000),
    ];
    const { schedule } = allocatePaymentOntoSchedule(start, pay(20000, "OFF-SPILL"));
    assert.equal(schedule[0]!.paid, true);
    assert.equal(schedule[0]!.amount, 25000);
    assert.equal(schedule[1]!.paid, false);
    assert.equal(schedule[1]!.paid_amount, 10000);
    assert.equal(schedule[1]!.amount, 25000);
    assert.equal(lineRemainingAmount(schedule[1]!), 15000);
    assert.equal(paidTotal(schedule, 50000), 35000);
  });

  test("TEST 6 a payment above the balance is capped and settles as full", () => {
    const capped = capOfflineAmount({
      kind: "installment",
      amount: 25000,
      enrollmentRemaining: 35000,
      amountOverride: 40000,
    });
    assert.equal(capped.ok, true);
    if (!capped.ok) return;
    assert.equal(capped.amount, 35000);
    assert.equal(capped.kind, "full");
    const { schedule } = allocatePaymentOntoSchedule(
      [line(1, 10000), line(2, 25000)],
      { amount: capped.amount, payment_kind: "full", reference_no: "OFF-CAP" },
    );
    assert.equal(schedule.every((s) => s.paid), true);
    assert.equal(paidTotal(schedule, 35000), 35000);

    const shortFull = capOfflineAmount({
      kind: "full",
      amount: 35000,
      enrollmentRemaining: 35000,
      amountOverride: 10000,
    });
    assert.equal(shortFull.ok, true);
    if (!shortFull.ok) return;
    assert.equal(shortFull.amount, 10000);
    assert.equal(shortFull.kind, "installment");
    const partial = allocatePaymentOntoSchedule(
      [line(1, 25000), line(2, 10000)],
      { amount: shortFull.amount, payment_kind: shortFull.kind, reference_no: "OFF-SHORT-FULL" },
    ).schedule;
    assert.equal(partial[0]!.paid, false);
    assert.equal(partial[0]!.paid_amount, 10000);
    assert.equal(paidTotal(partial, 35000), 10000);
  });

  test("TEST 7 retrying the same reference does not allocate twice", () => {
    const base = [line(1, 25000)];
    const once = replayPaymentsOntoSchedule(base, [pay(10000, "OFF-SAME"), pay(10000, "OFF-SAME")]);
    assert.equal(once[0]!.paid_amount, 10000);
    assert.equal(paidTotal(once, 25000), 10000);
  });

  test("TEST 8 two ₹10,000 payments with different references both count", () => {
    const schedule = replayPaymentsOntoSchedule(
      [line(1, 25000)],
      [pay(10000, "OFF-1"), pay(10000, "OFF-2")],
    );
    assert.equal(schedule[0]!.paid_amount, 20000);
    assert.equal(paidTotal(schedule, 25000), 20000);
  });

  test("TEST 9 and 10 add-student and existing-student offline payments share this allocator", () => {
    const addStudent = allocatePaymentOntoSchedule([line(1, 25000)], pay(10000, "OFF-NEW", "admin_offline")).schedule;
    const existing = allocatePaymentOntoSchedule([line(1, 25000)], pay(10000, "OFF-OLD", "admin_offline")).schedule;
    assert.equal(paidTotal(addStudent, 25000), 10000);
    assert.equal(paidTotal(existing, 25000), 10000);
    assert.equal(addStudent[0]!.paid, false);
    const proof = allocatePaymentOntoSchedule([line(1, 25000)], pay(10000, "OFF-PROOF", "student_proof")).schedule;
    assert.equal(proof[0]!.paid_amount, 10000);
    assert.equal(proof[0]!.paid, false);

    const studentsRoute = readFileSync(new URL("../../app/api/admin/students/route.ts", import.meta.url), "utf8");
    const paymentRoute = readFileSync(new URL("../../app/api/admin/students/[id]/payment/route.ts", import.meta.url), "utf8");
    const finalizer = readFileSync(new URL("../../lib/dataProvider.ts", import.meta.url), "utf8");
    assert.match(studentsRoute, /amountOverride: rp\.amount/);
    assert.match(studentsRoute, /initialPaymentForNewEnrollment/);
    assert.match(paymentRoute, /amountOverride: body\.amount/);
    assert.match(paymentRoute, /admin_offline/);
    assert.match(finalizer, /allocatePaymentOntoSchedule/);
    assert.match(finalizer, /replayPaymentsOntoSchedule/);
    assert.match(finalizer, /amount: payment\.amount/);
    assert.doesNotMatch(finalizer, /isProofPartial/);
    assert.match(finalizer, /if \(existing\)/);
  });

  test("TEST 11 a full payment still settles every open line", () => {
    const schedule = [line(1, 25000), line(2, 25000), line(3, 25000)];
    const { schedule: next, paymentLabel } = allocatePaymentOntoSchedule(
      schedule,
      { amount: 75000, payment_kind: "full", reference_no: "OFF-ALL" },
      { planType: "emi" },
    );
    assert.equal(next.every((s) => s.paid && s.amount === 25000), true);
    assert.equal(paidTotal(next), 75000);
    assert.equal(paymentLabel, "Full Remaining Payment");
  });

  test("TEST 12 a seat payment marks only the seat line", () => {
    const schedule: InstallmentItem[] = [
      { no: 0, kind: "seat", label: "Book Your Seat", amount: 2000, due: null, paid: false },
      line(1, 25000),
    ];
    const { schedule: next } = allocatePaymentOntoSchedule(schedule, {
      amount: 2000,
      payment_kind: "seat",
      installment_no: 0,
      reference_no: "OFF-SEAT",
    });
    assert.equal(next[0]!.paid, true);
    assert.equal(next[0]!.amount, 2000);
    assert.equal(next[1]!.paid, false);
    assert.equal(paidTotal(next, 27000), 2000);
    const shortSeat = capOfflineAmount({
      kind: "seat",
      amount: 2000,
      enrollmentRemaining: 27000,
      amountOverride: 1000,
    });
    assert.equal(shortSeat.ok, false);
  });
});

describe("partial remainder stays due", () => {
  test("the reminder quotes ₹15,000, not the ₹25,000 face and not the next installment", () => {
    const schedule = [line(1, 25000, { paid_amount: 10000, status: "partially_paid" }), line(2, 25000)];
    const enrollment = {
      id: "enr",
      phone: "9000000000",
      student_name: "Fixture",
      email: null,
      course_id: "c",
      course_slug: "c",
      course_title: "Course",
      batch_label: null,
      plan_type: "emi",
      total_fee: 50000,
      amount_paid: 10000,
      installment_count: 2,
      status: "partially_paid",
      schedule,
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-15T00:00:00.000Z",
    } as CourseEnrollment;
    const resolved = resolveInstallmentForEnrollment(enrollment, Date.parse("2026-12-01T00:00:00.000Z"));
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.resolved.installmentNo, 1);
    assert.equal(resolved.resolved.amountDue, 15000);
  });

  test("a cancelled line that already holds money is not chased", () => {
    const cancelled = line(1, 19333, { status: "cancelled", paid_amount: 18000, paid: false });
    assert.equal(isLineOutstanding(cancelled), false);
  });

  test("the admin preview names the money received and the remainder", () => {
    const preview = previewOfflineAllocation({
      schedule: [line(1, 25000), line(2, 25000)],
      kind: "installment",
      lineRemaining: 25000,
      enrollmentRemaining: 50000,
      amountOverride: 10000,
    });
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    const text = manualAllocationSentences(preview.notice).join(" ");
    assert.match(text, /Payment received today/);
    assert.match(text, /10,000/);
    assert.match(text, /earliest unpaid installment/);
    assert.match(text, /15,000 will remain due/);
    assert.equal(preview.notice.lines[0]!.obligation, 25000);
    assert.equal(preview.notice.lines[0]!.paidToDate, 10000);
  });
});
