import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildAdmissionStages } from "../../lib/analytics/executiveOverview";
import type { CourseEnrollment, InstallmentItem } from "../../lib/types";

function line(partial: Partial<InstallmentItem> & Pick<InstallmentItem, "kind" | "amount" | "paid">): InstallmentItem {
  return {
    no: partial.no ?? (partial.kind === "installment" ? 1 : 0),
    label: partial.label || partial.kind,
    due: partial.due ?? null,
    status: partial.status || (partial.paid ? "paid" : "due"),
    ...partial,
  };
}

function enr(partial: Partial<CourseEnrollment> & { id: string; schedule: InstallmentItem[] }): CourseEnrollment {
  return {
    phone: "9999999999",
    course_id: "c1",
    student_id: null,
    status: "active",
    total_fee: 60000,
    amount_paid: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as CourseEnrollment;
}

describe("buildAdmissionStages", () => {
  test("counts unique enrollments cumulatively across installment stages", () => {
    const rows = [
      enr({
        id: "e-seat",
        amount_paid: 2000,
        schedule: [line({ kind: "seat", amount: 2000, paid: true })],
      }),
      enr({
        id: "e-i1",
        amount_paid: 22000,
        schedule: [
          line({ kind: "seat", amount: 2000, paid: true }),
          line({ kind: "installment", amount: 20000, paid: true, label: "EMI 1" }),
          line({ kind: "installment", amount: 20000, paid: false, label: "EMI 2" }),
          line({ kind: "installment", amount: 18000, paid: false, label: "EMI 3" }),
        ],
      }),
      enr({
        id: "e-i2",
        amount_paid: 42000,
        schedule: [
          line({ kind: "seat", amount: 2000, paid: true }),
          line({ kind: "installment", amount: 20000, paid: true, label: "EMI 1" }),
          line({ kind: "installment", amount: 20000, paid: true, label: "EMI 2" }),
          line({ kind: "installment", amount: 18000, paid: false, label: "EMI 3" }),
        ],
      }),
      enr({
        id: "e-full",
        status: "fully_paid",
        amount_paid: 60000,
        schedule: [line({ kind: "full", amount: 60000, paid: true })],
      }),
      enr({
        id: "e-pending",
        status: "pending",
        amount_paid: 0,
        schedule: [line({ kind: "seat", amount: 2000, paid: false })],
      }),
    ];

    const stages = buildAdmissionStages(rows);
    const map = Object.fromEntries(stages.map((s) => [s.key, s.count]));

    // pending unpaid seat excluded
    assert.equal(map.seat, 4); // seat, i1, i2, full
    assert.equal(map.inst1, 3); // i1, i2, full (full jumps all stages)
    assert.equal(map.inst2, 2); // i2, full
    assert.equal(map.inst3, 1); // full only (i2 has only 2 EMIs paid)
    assert.equal(map.full, 1);
  });

  test("does not treat cancelled enrollments as funnel members", () => {
    const stages = buildAdmissionStages([
      enr({
        id: "x",
        status: "cancelled",
        amount_paid: 2000,
        schedule: [line({ kind: "seat", amount: 2000, paid: true })],
      }),
    ]);
    assert.equal(stages.find((s) => s.key === "seat")?.count, 0);
  });
});
