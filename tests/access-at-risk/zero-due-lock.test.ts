import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { lectureAccessForCourse } from "../../lib/entitlements";
import type { Course, CourseEnrollment } from "../../lib/types";

const course = {
  id: "c1",
  title: "Test",
  batch_start: "2026-06-01T18:30:00.000Z",
  batches: [{ id: "b1", label: "June", start_date: "2026-06-01T18:30:00.000Z", price: 60000 }],
} as unknown as Course;

function enr(partial: Partial<CourseEnrollment> & { schedule: CourseEnrollment["schedule"] }): CourseEnrollment {
  return {
    id: "e1",
    phone: "9815153424",
    student_name: "Harman",
    course_id: "c1",
    course_title: "Test",
    status: "partially_paid",
    amount_paid: 60000,
    total_fee: 60000,
    plan_type: "emi",
    installment_count: 1,
    batch_id: "b1",
    batch_label: "June",
    created_at: "2026-07-01T10:00:00.000Z",
    ...partial,
  } as CourseEnrollment;
}

describe("zero-due lines must not gate lecture access", () => {
  const now = Date.parse("2026-08-04T12:00:00.000Z");

  test("₹0 unpaid dated line does not block (Harman pattern, non-fully_paid)", () => {
    const e = enr({
      status: "partially_paid",
      schedule: [
        {
          no: 1, kind: "installment", label: "Legacy fee received (pre-portal)",
          amount: 60000, due: null, paid: true, status: "paid",
        },
        {
          no: 2, kind: "installment", label: "Installment 1 of 1",
          amount: 0, due: "2026-07-16T06:30:00.000Z", paid: false, status: "pending",
        },
      ],
    });
    const access = lectureAccessForCourse(course, e, undefined, false, now);
    assert.equal(access.allowed, true);
    assert.notEqual(access.status, "blocked");
  });

  test("null-amount unpaid dated line does not block", () => {
    const e = enr({
      amount_paid: 40000,
      total_fee: 40000,
      schedule: [
        { no: 1, kind: "installment", label: "Paid", amount: 40000, due: null, paid: true },
        { no: 2, kind: "installment", label: "Ghost", amount: null as unknown as number, due: "2026-07-01T06:30:00.000Z", paid: false },
      ],
    });
    const access = lectureAccessForCourse(course, e, undefined, false, now);
    assert.equal(access.allowed, true);
  });

  test("due=null unpaid line does not gate; positive past-due still does", () => {
    const e = enr({
      amount_paid: 10000,
      total_fee: 40000,
      status: "partially_paid",
      schedule: [
        { no: 1, kind: "installment", label: "Legacy", amount: 10000, due: null, paid: true },
        { no: 2, kind: "installment", label: "I1", amount: 10000, due: "2026-07-01T06:30:00.000Z", paid: false },
      ],
    });
    const access = lectureAccessForCourse(course, e, undefined, false, now);
    assert.equal(access.allowed, false);
    assert.equal(access.status, "blocked");
    assert.equal(access.amountDue, 10000);
  });

  test("fully_paid + ₹0 ghost line stays lifetime", () => {
    const e = enr({
      status: "fully_paid",
      schedule: [
        { no: 1, kind: "installment", label: "Legacy", amount: 60000, due: null, paid: true },
        { no: 2, kind: "installment", label: "Ghost", amount: 0, due: "2026-07-16T06:30:00.000Z", paid: false },
      ],
    });
    const access = lectureAccessForCourse(course, e, undefined, false, now);
    assert.equal(access.allowed, true);
    assert.equal(access.reason, "lifetime");
  });
});
