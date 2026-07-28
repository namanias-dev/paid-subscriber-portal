/**
 * A transfer keeps the old enrollment, unpaid lines and all. Every reader that
 * chases money or scopes a student to a batch must therefore skip it, or the
 * student's outstanding balance is counted once on the superseded row and again
 * on the row that replaced it.
 *
 * This was a real bug: isActiveEnrollment excluded only `cancelled`, so a
 * transferred-out row with amount_paid > 0 read as a live enrollment.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isActiveEnrollment, isAttemptEnrollment, isSupersededEnrollment, deriveCollections } from "../../lib/installments";
import type { CourseEnrollment, InstallmentItem } from "../../lib/types";

/** Shipra's shape after a transfer: paid seat, unpaid balance, superseded. */
const SCHEDULE: InstallmentItem[] = [
  { no: 0, kind: "seat", label: "Book Your Seat", amount: 2000, due: null, paid: true },
  { no: 1, kind: "installment", label: "Remaining balance", amount: 38000, due: "2026-08-01T06:30:00.000Z", paid: false },
];
const supersededRow = { status: "transferred_out", amount_paid: 2000, superseded_by: "e-new", total_fee: 40000, schedule: SCHEDULE } as unknown as CourseEnrollment;
const liveRow = { status: "seat_booked", amount_paid: 2000, superseded_by: null, total_fee: 40000, schedule: SCHEDULE } as unknown as CourseEnrollment;

describe("a superseded enrollment is not a live one", () => {
  test("isActiveEnrollment rejects a transferred-out row", () => {
    assert.equal(isActiveEnrollment(supersededRow), false, "this is what double-counted the money");
    assert.equal(isActiveEnrollment(liveRow), true, "and the live row must still count");
  });

  test("it is recognised as superseded by status or by pointer", () => {
    assert.equal(isSupersededEnrollment(supersededRow), true);
    assert.equal(isSupersededEnrollment({ status: "seat_booked", superseded_by: "e-new" } as never), true, "the pointer alone is enough");
    assert.equal(isSupersededEnrollment(liveRow), false);
  });

  test("it is not misfiled as an abandoned payment attempt either", () => {
    // isAttemptEnrollment is the inverse of isActiveEnrollment, so excluding the
    // row from "active" silently reclassifies it as an attempt. Callers must
    // combine the two checks, which is what the student profile now does.
    assert.equal(isAttemptEnrollment(supersededRow), true, "the inverse does flip, which is exactly the trap");
    assert.equal(isAttemptEnrollment(supersededRow) && !isSupersededEnrollment(supersededRow), false,
      "so the combined test used by the profile must exclude it from both buckets");
  });
});

describe("the money is counted once, not twice", () => {
  test("summing only active rows yields one outstanding balance, not two", () => {
    const both = [supersededRow, { ...liveRow, id: "e-new" } as CourseEnrollment];
    const outstanding = both.filter(isActiveEnrollment)
      .reduce((a, e) => a + deriveCollections(e).remaining, 0);
    assert.equal(outstanding, 38000, "before the fix this summed to 76000");
  });

  test("the superseded row still reports its own balance when asked directly", () => {
    // deriveCollections is per-row and stays honest; the filtering is the caller's
    // job, so history remains readable for a dispute.
    assert.equal(deriveCollections(supersededRow).remaining, 38000);
  });
});
