import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { lectureAccessForCourse } from "../../lib/entitlements";
import { isAccessAtRiskEnrollment } from "../../lib/accessAtRisk";
import { scheduleAsCheckoutIntent, isPhantomEnrollment } from "../../lib/enrollmentScope";
import { materializeScheduleDues } from "../../lib/scheduleDues";
import { assertBatchesHaveStartDates } from "../../lib/landing";
import { buildSchedule } from "../../lib/installments";
import type { Course, CourseEnrollment } from "../../lib/types";

const course = {
  id: "c1",
  title: "Test",
  batch_start: "2026-08-10T18:30:00.000Z",
  batches: [{ id: "b1", label: "Starts 10 Aug 2026", start_date: "2026-08-10T18:30:00.000Z", price: 40000 }],
} as unknown as Course;

const courseUnknown = {
  id: "c2",
  title: "Legacy",
  batch_start: null,
  batches: [{ id: "b2", label: "Online · Evening", start_date: null, price: 40000 }],
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

describe("phantom checkout intents", () => {
  test("checkout_intent with stripped dues never access-risk / never enrolled", () => {
    const dated = buildSchedule({
      total: 45000, seatAmount: 5000, count: 3, bookingISO: "2026-07-01T00:00:00.000Z",
      firstIntervalDays: 7, intervalMonths: 1, batchStartISO: "2026-08-10T18:30:00.000Z",
    });
    const intent = scheduleAsCheckoutIntent(dated);
    assert.ok(intent.every((s) => !s.due));
    const e = enr({
      status: "checkout_intent",
      amount_paid: 0,
      course_id: "c1",
      schedule: intent,
    });
    assert.equal(isPhantomEnrollment(e), true);
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    const access = lectureAccessForCourse(course, e, undefined, false, now);
    assert.equal(access.allowed, false);
    assert.equal(access.reason, "not_enrolled");
    assert.equal(isAccessAtRiskEnrollment({ enrollment: e, scheduleAccess: access, now }), false);
  });

  test("materialize dues on activation preserves amounts", () => {
    const dated = buildSchedule({
      total: 45000, seatAmount: 5000, count: 3, bookingISO: "2026-07-01T00:00:00.000Z",
      firstIntervalDays: 7, intervalMonths: 1, batchStartISO: "2026-08-10T18:30:00.000Z",
    });
    const intent = scheduleAsCheckoutIntent(dated);
    const amounts = intent.map((s) => s.amount);
    const live = materializeScheduleDues(intent, {
      bookingISO: "2026-07-01T00:00:00.000Z",
      batchStartISO: "2026-08-10T18:30:00.000Z",
    });
    assert.deepEqual(live.map((s) => s.amount), amounts);
    const inst1 = live.find((s) => s.no === 1)!;
    assert.ok(inst1.due);
    assert.ok(Date.parse(inst1.due!) >= Date.parse("2026-08-10T18:30:00.000Z"));
  });
});

describe("UNKNOWN batch start fail-safe", () => {
  test("overdue installment + unknown batch → never blocked / never at-risk", () => {
    const e = enr({
      course_id: "c2",
      batch_id: "b2",
      batch_label: "Online · Evening",
      status: "partially_paid",
      amount_paid: 5000,
      schedule: [
        { no: 0, kind: "seat", label: "Seat", amount: 5000, due: null, paid: true },
        { no: 1, kind: "installment", label: "Installment 1 of 3", amount: 13333, due: "2026-06-01T00:00:00.000Z", paid: false },
        { no: 2, kind: "installment", label: "Installment 2 of 3", amount: 13333, due: "2026-07-01T00:00:00.000Z", paid: false },
        { no: 3, kind: "installment", label: "Installment 3 of 3", amount: 13334, due: "2026-08-01T00:00:00.000Z", paid: false },
      ],
    });
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    const access = lectureAccessForCourse(courseUnknown, e, undefined, false, now);
    assert.equal(access.allowed, true);
    assert.equal(access.status, "active");
    assert.equal(isAccessAtRiskEnrollment({ enrollment: e, scheduleAccess: access, now }), false);
  });
});

describe("new batch start_date validation", () => {
  test("new course requires structured start on every batch", () => {
    const bad = assertBatchesHaveStartDates([{ id: "b-new", start_date: null }], { requireAll: true });
    assert.equal(bad.ok, false);
    const good = assertBatchesHaveStartDates([{ id: "b-new", start_date: "2026-08-10T18:30:00.000Z" }], { requireAll: true });
    assert.equal(good.ok, true);
  });

  test("legacy batches without start may remain on PATCH; new ids must have start", () => {
    const prev = new Set(["b-old"]);
    const okLegacy = assertBatchesHaveStartDates([{ id: "b-old", start_date: null }], { previousIds: prev });
    assert.equal(okLegacy.ok, true);
    const badNew = assertBatchesHaveStartDates(
      [{ id: "b-old", start_date: null }, { id: "b-new", start_date: null }],
      { previousIds: prev },
    );
    assert.equal(badNew.ok, false);
  });
});
