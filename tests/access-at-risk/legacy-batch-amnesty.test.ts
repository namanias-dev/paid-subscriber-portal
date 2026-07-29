import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isPaidInJuly2026,
  needsAmnesty,
  SAARTHI_OLD_ID,
  SAFALTA_OLD_ID,
  scheduleAccessWithStart,
  SAARTHI_START_ISO,
  SAFALTA_START_ISO,
} from "../../lib/legacyBatchStartBackfill";
import type { CourseEnrollment } from "../../lib/types";

describe("legacy batch amnesty helpers", () => {
  it("July 2026 payment uses transaction_date only (not null legacy)", () => {
    assert.equal(isPaidInJuly2026({
      enrollment_id: "e1", phone: "9", status: "PAID",
      transaction_date: "2026-07-15T10:00:00.000Z", created_at: "2026-07-24T00:00:00.000Z",
      import_source: null, amount: 1000,
    }), true);
    assert.equal(isPaidInJuly2026({
      enrollment_id: "e1", phone: "9", status: "PAID",
      transaction_date: null, created_at: "2026-07-24T00:00:00.000Z",
      import_source: "saarthi_legacy", amount: 40000,
    }), false, "null-dated legacy must not count as July payment");
    assert.equal(isPaidInJuly2026({
      enrollment_id: "e1", phone: "9", status: "FAILED",
      transaction_date: "2026-07-15T10:00:00.000Z", created_at: null,
      import_source: null, amount: 1000,
    }), false);
  });

  it("amnesty rules: Safalta blocked → yes; Saarthi blocked only if no July pay", () => {
    assert.equal(needsAmnesty({ courseId: SAFALTA_OLD_ID, scheduleStatus: "blocked", paidInJuly: true }), true);
    assert.equal(needsAmnesty({ courseId: SAFALTA_OLD_ID, scheduleStatus: "grace", paidInJuly: false }), false);
    assert.equal(needsAmnesty({ courseId: SAARTHI_OLD_ID, scheduleStatus: "blocked", paidInJuly: true }), false);
    assert.equal(needsAmnesty({ courseId: SAARTHI_OLD_ID, scheduleStatus: "blocked", paidInJuly: false }), true);
    assert.equal(needsAmnesty({ courseId: SAARTHI_OLD_ID, scheduleStatus: "grace", paidInJuly: false }), false);
  });

  it("Saarthi March-1 start leaves July-16 due in grace on 2026-07-28", () => {
    const e = {
      id: "e", phone: "9999999999", student_name: "T",
      course_id: SAARTHI_OLD_ID, status: "partially_paid",
      amount_paid: 10000, total_fee: 40000,
      created_at: "2026-07-08T00:00:00.000Z",
      schedule: [{
        no: 2, kind: "installment", label: "Installment 1",
        amount: 10000, due: "2026-07-16T00:00:00.000Z", paid: false, status: "pending",
      }],
    } as unknown as CourseEnrollment;
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const a = scheduleAccessWithStart(e, SAARTHI_START_ISO, now);
    assert.equal(a.status, "grace");
    assert.equal(a.allowed, true);
  });

  it("Safalta June-1 start leaves July-9 due blocked on 2026-07-28", () => {
    const e = {
      id: "e", phone: "9999999999", student_name: "T",
      course_id: SAFALTA_OLD_ID, status: "partially_paid",
      amount_paid: 20000, total_fee: 40000,
      created_at: "2026-07-01T00:00:00.000Z",
      schedule: [{
        no: 2, kind: "installment", label: "Installment 1",
        amount: 20000, due: "2026-07-09T00:00:00.000Z", paid: false, status: "pending",
      }],
    } as unknown as CourseEnrollment;
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const a = scheduleAccessWithStart(e, SAFALTA_START_ISO, now);
    assert.equal(a.status, "blocked");
    assert.equal(a.allowed, false);
  });
});
