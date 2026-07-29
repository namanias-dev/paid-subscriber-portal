import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { lectureAccessForCourse } from "../../lib/entitlements";
import { buildSchedule, firstInstallmentDueISO, isActiveEnrollment } from "../../lib/installments";
import { isAccessAtRiskEnrollment, humanRemindInaction, nextUnpaidDatedLine } from "../../lib/accessAtRisk";
import type { Course, CourseEnrollment } from "../../lib/types";

const course = {
  id: "c1",
  title: "Test",
  batch_start: "2026-08-10T18:30:00.000Z", // 11 Aug IST midnight-ish / catalog style
  batches: [{ id: "b1", label: "Starts 10 Aug 2026", start_date: "2026-08-10T18:30:00.000Z", price: 40000 }],
} as unknown as Course;

function enr(partial: Partial<CourseEnrollment> & { schedule: CourseEnrollment["schedule"] }): CourseEnrollment {
  return {
    id: "e1",
    phone: "9999999999",
    student_name: "Test",
    course_id: "c1",
    course_title: "Test",
    status: "seat_booked",
    amount_paid: 2000,
    total_fee: 40000,
    plan_type: "emi",
    installment_count: 3,
    batch_id: "b1",
    batch_label: "Starts 10 Aug 2026 · Morning",
    created_at: "2026-07-02T10:00:00.000Z",
    ...partial,
  } as CourseEnrollment;
}

describe("batch-start access invariant", () => {
  test("booked 2 Jul, batch 10 Aug, inst1 due 9 Jul → NOT blocked/grace before batch start", () => {
    const e = enr({
      schedule: [
        { no: 0, kind: "seat", label: "Seat", amount: 2000, due: null, paid: true },
        { no: 1, kind: "installment", label: "Installment 1 of 3", amount: 12666, due: "2026-07-09T06:30:00.000Z", paid: false },
        { no: 2, kind: "installment", label: "Installment 2 of 3", amount: 12667, due: "2026-08-09T06:30:00.000Z", paid: false },
        { no: 3, kind: "installment", label: "Installment 3 of 3", amount: 12667, due: "2026-09-09T06:30:00.000Z", paid: false },
      ],
    });
    // Mid July — after inst1 due, before batch start
    const now = Date.parse("2026-07-20T12:00:00.000Z");
    const access = lectureAccessForCourse(course, e, undefined, false, now);
    assert.equal(access.allowed, true);
    assert.equal(access.status, "active");
    assert.notEqual(access.status, "grace");
    assert.notEqual(access.status, "blocked");
    assert.equal(isAccessAtRiskEnrollment({ enrollment: e, scheduleAccess: access, now }), false);
  });

  test("after batch start, overdue unpaid still blocks", () => {
    const e = enr({
      status: "partially_paid",
      schedule: [
        { no: 1, kind: "installment", label: "Installment 1 of 3", amount: 15000, due: "2026-07-01T00:00:00.000Z", paid: false },
        { no: 2, kind: "installment", label: "Installment 2 of 3", amount: 15000, due: "2026-09-01T00:00:00.000Z", paid: false },
        { no: 3, kind: "installment", label: "Installment 3 of 3", amount: 15000, due: "2026-11-01T00:00:00.000Z", paid: false },
      ],
    });
    const now = Date.parse("2026-08-20T12:00:00.000Z"); // after batch start + past grace
    const access = lectureAccessForCourse(course, e, undefined, false, now);
    assert.equal(access.status, "blocked");
    assert.equal(access.reason, "overdue");
  });
});

describe("firstInstallmentDueISO / buildSchedule anchoring", () => {
  test("new enrolment with future batch start → inst1 on/after batch start", () => {
    const booking = "2026-07-02T10:00:00.000Z";
    const batch = "2026-08-10T18:30:00.000Z";
    const due = firstInstallmentDueISO(booking, 7, batch);
    assert.ok(Date.parse(due) >= Date.parse(batch));
    const sched = buildSchedule({
      total: 40000, seatAmount: 2000, count: 3, bookingISO: booking,
      firstIntervalDays: 7, intervalMonths: 1, batchStartISO: batch,
    });
    const inst1 = sched.find((s) => s.no === 1)!;
    assert.ok(Date.parse(inst1.due!) >= Date.parse(batch));
  });

  test("null batch start falls back safely", () => {
    const booking = "2026-07-02T10:00:00.000Z";
    const due = firstInstallmentDueISO(booking, 7, null);
    assert.ok(due);
    const sched = buildSchedule({
      total: 40000, seatAmount: 2000, count: 3, bookingISO: booking,
      firstIntervalDays: 7, intervalMonths: 1, batchStartISO: null,
    });
    assert.equal(sched.filter((s) => s.kind === "installment").length, 3);
  });
});

describe("shared at-risk definition", () => {
  test("pending ₹0 enrollment is never at risk", () => {
    const e = enr({
      status: "pending",
      amount_paid: 0,
      schedule: [
        { no: 1, kind: "installment", label: "Inst 1", amount: 45000, due: "2026-07-01T00:00:00.000Z", paid: false },
      ],
    });
    assert.equal(isActiveEnrollment(e), false);
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    const access = lectureAccessForCourse(course, e, undefined, false, now);
    assert.equal(isAccessAtRiskEnrollment({ enrollment: e, scheduleAccess: access, now }), false);
  });

  test("partially paid current on plan → not listed", () => {
    const e = enr({
      status: "partially_paid",
      amount_paid: 15000,
      schedule: [
        { no: 1, kind: "installment", label: "Installment 1 of 3", amount: 15000, due: "2026-06-29T00:00:00.000Z", paid: true },
        { no: 2, kind: "installment", label: "Installment 2 of 3", amount: 15000, due: "2026-08-30T06:30:00.000Z", paid: false },
        { no: 3, kind: "installment", label: "Installment 3 of 3", amount: 15000, due: "2026-10-30T06:30:00.000Z", paid: false },
      ],
    });
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const access = lectureAccessForCourse(course, e, undefined, false, now);
    assert.equal(access.status, "active");
    assert.equal(isAccessAtRiskEnrollment({ enrollment: e, scheduleAccess: access, now }), false);
    const next = nextUnpaidDatedLine(e.schedule);
    assert.equal(next?.no, 2);
    const reason = humanRemindInaction({
      blockReason: "not_access_risk",
      nextUnpaid: next,
      scheduleStatus: "active",
    });
    assert.match(reason || "", /Not due yet/i);
  });
});
