import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { validateAccessGrant, ACCESS_GRANT_MAX_DAYS_DEFAULT } from "../../lib/accessOverridePolicy";
import { paymentProgressLabel, deriveEnrollment } from "../../lib/installments";
import type { CourseEnrollment } from "../../lib/types";

describe("validateAccessGrant", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");

  test("reason mandatory", () => {
    const r = validateAccessGrant({
      expiresAt: new Date(now + 3 * 86400000).toISOString(),
      reason: "  ",
      elevated: false,
      now,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "reason_required");
  });

  test("indefinite rejected", () => {
    const r = validateAccessGrant({ expiresAt: null, reason: "help", elevated: true, now });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "indefinite_forbidden");
  });

  test("default cap 7 days without elevated", () => {
    const r = validateAccessGrant({
      expiresAt: new Date(now + 10 * 86400000).toISOString(),
      reason: "extra time",
      elevated: false,
      now,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "duration_exceeds_cap");
  });

  test("elevated allows >7 days", () => {
    const r = validateAccessGrant({
      expiresAt: new Date(now + 30 * 86400000).toISOString(),
      reason: "director approved",
      elevated: true,
      now,
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.ok(r.days > ACCESS_GRANT_MAX_DAYS_DEFAULT);
  });

  test("7 days ok without elevated", () => {
    const r = validateAccessGrant({
      expiresAt: new Date(now + 7 * 86400000).toISOString(),
      reason: "short bridge",
      elevated: false,
      now,
    });
    assert.equal(r.ok, true);
  });
});

describe("paymentProgressLabel", () => {
  test("seat booked never reads as nothing paid", () => {
    const enr = {
      total_fee: 40000,
      schedule: [
        { no: 0, kind: "seat", label: "Seat", amount: 2000, paid: true, due: null, status: "paid" },
        { no: 1, kind: "installment", label: "Inst 1", amount: 12666, paid: false, due: "2026-07-01", status: "due" },
        { no: 2, kind: "installment", label: "Inst 2", amount: 12667, paid: false, due: "2026-08-01", status: "due" },
        { no: 3, kind: "installment", label: "Inst 3", amount: 12667, paid: false, due: "2026-09-01", status: "due" },
      ],
    } as Pick<CourseEnrollment, "total_fee" | "schedule">;
    const d = deriveEnrollment(enr);
    assert.equal(d.paidCount, 0);
    assert.equal(d.installmentTotal, 3);
    assert.equal(d.seatPaid, true);
    assert.equal(d.paid, 2000);
    const label = paymentProgressLabel(d);
    assert.match(label, /Seat booked/i);
    assert.match(label, /0 of 3 installments paid/);
    assert.notEqual(label, "0 of 3 installments paid");
  });
});
