import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveEnrollment, planCourseEnrollment } from "../../lib/installments";
import { findOldestOutstandingIndex } from "../../lib/installmentAllocation";
import { collectedToday, initialPaymentForNewEnrollment } from "../../lib/manualEnrollmentPayments";
import { lineAllocatedAmount } from "../../lib/enrollmentFeeState";
import type { Course, InstallmentItem } from "../../lib/types";

const BOOKING = "2026-10-15T04:30:00.000Z";

function feeCourse(price: number, seat: number | null): Course {
  return {
    id: "co",
    slug: "safalta",
    title: "SAFALTA",
    price,
    batches: [],
    emi_config: {
      enabled: true,
      allow_full: true,
      allow_custom_seat: seat != null,
      seat_amount: seat,
      min_seat_amount: seat,
      installment_counts: [3],
      first_interval_days: 7,
      interval_months: 1,
    },
  } as unknown as Course;
}

function threeInstallments(total: number): InstallmentItem[] {
  const plan = planCourseEnrollment({
    course: feeCourse(total, null),
    plan: "emi",
    bookSeat: false,
    installmentCount: 3,
    bookingISO: BOOKING,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) throw new Error(plan.error);
  return plan.plan.schedule;
}

/** One successful payment closes the oldest matching line and counts that line once. */
function applyOnce(schedule: InstallmentItem[], kind: "seat" | "installment" | "full", amount: number): InstallmentItem[] {
  const next = schedule.map((s) => ({ ...s }));
  if (kind === "full") {
    for (const line of next) {
      if (!line.paid) line.paid = true;
    }
    return next;
  }
  const idx = findOldestOutstandingIndex(next, kind);
  assert.notEqual(idx, -1);
  const line = next[idx];
  if (amount < line.amount) {
    next[idx] = { ...line, paid: false, paid_amount: amount, status: "partially_paid" };
  } else {
    next[idx] = { ...line, paid: true, paid_amount: line.amount };
  }
  return next;
}

function paidOf(schedule: InstallmentItem[], total: number): number {
  return deriveEnrollment({ total_fee: total, schedule }).paid;
}

describe("manual add-student does not record the first installment twice", () => {
  test("B1 a ₹25,000 first installment is exactly ₹25,000 paid", () => {
    const decision = initialPaymentForNewEnrollment({
      createdCourseSlugs: ["safalta"],
      recordedCourseSlugs: ["safalta"],
      initial: { courseSlug: "safalta", kind: "installment", method: "Cash" },
    });
    assert.equal(decision.payment, null);
    assert.equal(decision.skippedBecause, "line_already_recorded");
    const schedule = applyOnce(threeInstallments(75000), "installment", 25000);
    assert.equal(paidOf(schedule, 75000), 25000);
    assert.equal(collectedToday([25000]), 25000);
  });

  test("B2 a ₹2,000 first payment is exactly ₹2,000 paid", () => {
    const plan = planCourseEnrollment({
      course: feeCourse(85000, 2000),
      plan: "emi",
      bookSeat: true,
      installmentCount: 3,
      bookingISO: BOOKING,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    const schedule = applyOnce(plan.plan.schedule, "seat", 2000);
    assert.equal(paidOf(schedule, 85000), 2000);
  });

  test("B3 no initial payment leaves ₹0 paid", () => {
    const decision = initialPaymentForNewEnrollment({
      createdCourseSlugs: ["safalta"],
      recordedCourseSlugs: [],
      initial: null,
    });
    assert.equal(decision.payment, null);
    assert.equal(paidOf(threeInstallments(75000), 75000), 0);
    assert.equal(collectedToday([]), 0);
  });

  test("B4 a full payment is recorded once", () => {
    const decision = initialPaymentForNewEnrollment({
      createdCourseSlugs: ["safalta"],
      recordedCourseSlugs: ["safalta"],
      initial: { courseSlug: "safalta", kind: "full", method: "Cash" },
    });
    assert.equal(decision.payment, null);
    const schedule = applyOnce(
      [{ no: 0, kind: "full", label: "Full Payment", amount: 70000, due: null, paid: false }],
      "full",
      70000,
    );
    assert.equal(paidOf(schedule, 70000), 70000);
    assert.equal(collectedToday([70000]), 70000);
  });

  test("B5 another ₹25,000 on an existing enrollment adds ₹25,000 once", () => {
    let schedule = applyOnce(threeInstallments(75000), "installment", 25000);
    assert.equal(paidOf(schedule, 75000), 25000);
    schedule = applyOnce(schedule, "installment", 25000);
    assert.equal(paidOf(schedule, 75000), 50000);
    assert.equal(collectedToday([25000]), 25000);
  });

  test("B6 and B7 a repeated create does not pay the enrollment again", () => {
    const first = initialPaymentForNewEnrollment({
      createdCourseSlugs: ["safalta"],
      recordedCourseSlugs: [],
      initial: { courseSlug: "safalta", kind: "installment", method: "Cash" },
    });
    assert.equal(first.payment?.kind, "installment");
    const retry = initialPaymentForNewEnrollment({
      createdCourseSlugs: [],
      recordedCourseSlugs: [],
      initial: { courseSlug: "safalta", kind: "installment", method: "Cash" },
    });
    assert.equal(retry.payment, null);
    assert.equal(retry.skippedBecause, "not_created");
  });

  test("B8 and B9 one payment is not summed once per allocation row", () => {
    const oneLine = applyOnce(threeInstallments(75000), "installment", 25000);
    const paidLine = oneLine.find((s) => s.paid);
    assert.ok(paidLine);
    assert.equal(lineAllocatedAmount(paidLine!), 25000);
    assert.equal(paidOf(oneLine, 75000), 25000);

    const split = threeInstallments(75000).map((s, i) => {
      if (i === 0) return { ...s, paid: false, paid_amount: 10000, status: "partially_paid" as const };
      if (i === 1) return { ...s, paid: false, paid_amount: 15000, status: "partially_paid" as const };
      return s;
    });
    const allocationRows = split.filter((s) => (s.paid_amount || 0) > 0).length;
    assert.equal(allocationRows, 2);
    assert.equal(paidOf(split, 75000), 25000);
    assert.notEqual(paidOf(split, 75000), 25000 * allocationRows);
  });

  test("B10 a seat configuration is not added on top of the installment already received", () => {
    const decision = initialPaymentForNewEnrollment({
      createdCourseSlugs: ["safalta"],
      recordedCourseSlugs: ["safalta"],
      initial: { courseSlug: "safalta", kind: "seat", method: "Offline UPI" },
    });
    assert.equal(decision.payment, null);
    const plan = planCourseEnrollment({
      course: feeCourse(77000, 2000),
      plan: "emi",
      bookSeat: true,
      installmentCount: 3,
      bookingISO: BOOKING,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    const schedule = applyOnce(plan.plan.schedule, "installment", 25000);
    assert.equal(paidOf(schedule, 77000), 25000);
    assert.equal(schedule.find((s) => s.kind === "seat")?.paid, false);
  });

  test("the add-student route uses the single-payment decision", () => {
    const route = readFileSync(new URL("../../app/api/admin/students/route.ts", import.meta.url), "utf8");
    const form = readFileSync(new URL("../../components/admin/StudentForm.tsx", import.meta.url), "utf8");
    assert.match(route, /initialPaymentForNewEnrollment/);
    assert.match(route, /line_already_recorded/);
    assert.match(form, /Payment received today/);
    assert.match(form, /courseAlreadyReceived/);
    assert.doesNotMatch(route, /getCourseEnrollmentsByPhone\(phone\)/);
  });
});
