import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { lectureAccessForCourse } from "../../lib/entitlements";
import type { Course, CourseAccessOverride, CourseEnrollment } from "../../lib/types";

const course = {
  id: "c1",
  title: "Safalta",
  entitlements: {},
  batch_start: "2026-06-01T18:30:00.000Z",
  batches: [{ id: "b1", label: "June", start_date: "2026-06-01T18:30:00.000Z", price: 40000 }],
} as unknown as Course;

function enr(partial: Partial<CourseEnrollment>): CourseEnrollment {
  return {
    id: "e1",
    phone: "7726888653",
    student_name: "Dev Chandra",
    course_id: "c1",
    course_title: "Safalta",
    status: "fully_paid",
    amount_paid: 40000,
    total_fee: 40000,
    plan_type: "emi",
    installment_count: 2,
    batch_id: "b1",
    batch_label: "June",
    created_at: "2026-07-01T20:36:51.416Z",
    schedule: [
      { no: 1, kind: "installment", label: "Legacy", amount: 20000, due: null, paid: true, status: "paid" },
      { no: 2, kind: "installment", label: "Inst 1", amount: 10000, due: "2026-07-09T06:30:00.000Z", paid: true, status: "paid" },
      { no: 3, kind: "installment", label: "Inst 2", amount: 10000, due: "2026-08-09T06:30:00.000Z", paid: true, status: "paid" },
    ],
    ...partial,
  } as CourseEnrollment;
}

describe("expired grant must not lock fully-paid students", () => {
  const now = Date.parse("2026-08-12T06:00:00.000Z");

  test("expired temporary grant falls through to fully_paid access", () => {
    const override: CourseAccessOverride = {
      id: "o1",
      phone: "7726888653",
      course_id: "c1",
      mode: "grant",
      expires_at: "2026-08-11T18:30:00.000Z",
      note: "grandfathered notice — silent lock from batch-start resolution",
      created_by: "system",
      created_at: "2026-07-29T02:07:22.911Z",
      updated_at: "2026-08-04T22:21:09.207Z",
    };
    const access = lectureAccessForCourse(course, enr({}), override, false, now);
    assert.equal(access.allowed, true);
    assert.equal(access.status, "active");
  });

  test("active grant still wins while unexpired", () => {
    const override: CourseAccessOverride = {
      id: "o1",
      phone: "7726888653",
      course_id: "c1",
      mode: "grant",
      expires_at: "2026-08-15T18:30:00.000Z", // within EXPIRING_SOON_DAYS (7)
      note: "grant",
      created_by: "system",
      created_at: "2026-07-29T02:07:22.911Z",
      updated_at: "2026-08-04T22:21:09.207Z",
    };
    const access = lectureAccessForCourse(course, enr({}), override, false, now);
    assert.equal(access.allowed, true);
    assert.equal(access.status, "expiring");
  });

  test("fee-state fully paid grants access even if status column is stale", () => {
    const access = lectureAccessForCourse(
      course,
      enr({ status: "partially_paid" }),
      undefined,
      false,
      now,
    );
    assert.equal(access.allowed, true);
  });

  test("part-paid with overdue installment still blocked", () => {
    const access = lectureAccessForCourse(
      course,
      enr({
        status: "partially_paid",
        amount_paid: 20000,
        schedule: [
          { no: 1, kind: "installment", label: "Legacy", amount: 20000, due: null, paid: true, status: "paid" },
          {
            no: 2,
            kind: "installment",
            label: "Inst 1",
            amount: 10000,
            due: "2026-07-09T06:30:00.000Z",
            paid: false,
            status: "pending",
          },
          {
            no: 3,
            kind: "installment",
            label: "Inst 2",
            amount: 10000,
            due: "2026-08-09T06:30:00.000Z",
            paid: false,
            status: "pending",
          },
        ],
      }),
      undefined,
      false,
      now,
    );
    assert.equal(access.allowed, false);
    assert.equal(access.reason, "overdue");
  });
});
