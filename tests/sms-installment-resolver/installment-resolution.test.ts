/**
 * Installment resolution — which installment a reminder refers to, and for how
 * much.
 *
 * These figures go into an SMS to a paying student, so they are checked against
 * `deriveCollections` (lib/installments) rather than an independent calculation.
 * That function is what the Fees & EMI cards, the cohort drill-in and the
 * Fees-at-Risk worklist render from; asserting both here is what stops the SMS
 * and the screen from ever quoting different numbers.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { deriveCollections } from "../../lib/installments";
import {
  formatFeeInRs, installmentReminderVars, lineOutstanding, pickReminderEnrollment,
  resolveInstallmentForEnrollment,
} from "../../lib/sms/installmentReminder";
import type { CourseEnrollment, InstallmentItem } from "../../lib/types";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-27T12:00:00+05:30");

function line(p: Partial<InstallmentItem> & { no: number }): InstallmentItem {
  return {
    kind: "installment", label: `Installment ${p.no}`, amount: 8000,
    due: new Date(NOW - DAY).toISOString(), paid: false, ...p,
  };
}

function enrollment(schedule: InstallmentItem[], over: Partial<CourseEnrollment> = {}): CourseEnrollment {
  const paidSum = schedule.filter((s) => s.paid).reduce((a, s) => a + s.amount, 0);
  return {
    id: "enr-1", phone: "9876543210", student_name: "Priya Sharma", email: null,
    course_id: "c1", course_slug: "upsc", course_title: "UPSC Foundation 2027",
    batch_label: null, plan_type: "emi",
    total_fee: schedule.reduce((a, s) => a + s.amount, 0),
    amount_paid: paidSum, installment_count: schedule.length,
    status: paidSum > 0 ? "partially_paid" : "pending", schedule,
    created_at: new Date(NOW - 90 * DAY).toISOString(), updated_at: new Date(NOW).toISOString(),
    ...over,
  } as CourseEnrollment;
}

describe("the reminder targets the OLDEST unpaid installment", () => {
  test("picks the first outstanding line, not the most overdue-looking one", () => {
    const e = enrollment([
      line({ no: 1, paid: true, due: new Date(NOW - 60 * DAY).toISOString() }),
      line({ no: 2, due: new Date(NOW - 30 * DAY).toISOString() }),
      line({ no: 3, due: new Date(NOW - 2 * DAY).toISOString() }),
    ]);
    const r = resolveInstallmentForEnrollment(e, NOW);
    assert.ok(r.ok);
    assert.equal(r.resolved.installmentNo, 2);
    assert.equal(r.resolved.unpaidCount, 2);
    assert.equal(r.resolved.isOverdue, true);
  });

  test("agrees with what the EMI / at-risk pages show as next payable", () => {
    const e = enrollment([
      line({ no: 1, paid: true }),
      line({ no: 2, due: new Date(NOW + 5 * DAY).toISOString() }),
      line({ no: 3, due: new Date(NOW + 35 * DAY).toISOString() }),
    ]);
    const page = deriveCollections(e, NOW);
    const r = resolveInstallmentForEnrollment(e, NOW);
    assert.ok(r.ok);
    assert.equal(r.resolved.installmentNo, page.nextPayable?.no);
    assert.equal(r.resolved.amountDue, page.nextDueAmount);
    assert.equal(r.resolved.dueDate, page.nextDueDate);
    assert.equal(r.resolved.matchesPageNextPayable, true);
    assert.equal(r.resolved.totalRemaining, page.remaining);
  });

  test("skips waived and cancelled lines — a forgiven installment is never chased", () => {
    const e = enrollment([
      line({ no: 1, paid: true }),
      line({ no: 2, status: "waived" }),
      line({ no: 3, status: "cancelled" }),
      line({ no: 4, amount: 5000 }),
    ]);
    const r = resolveInstallmentForEnrollment(e, NOW);
    assert.ok(r.ok);
    assert.equal(r.resolved.installmentNo, 4);
    assert.equal(r.resolved.amountDue, 5000);
    assert.equal(r.resolved.unpaidCount, 1);
  });

  test("an unpaid SEAT line does not become 'installment no. 0'", () => {
    // deriveCollections' nextPayable is the seat line here, but "installment
    // no. 0" is not a thing a student can act on. We chase installment 1 and
    // flag the divergence rather than hiding it.
    const e = enrollment([
      { no: 0, kind: "seat", label: "Book Your Seat", amount: 2000, due: null, paid: false },
      line({ no: 1, amount: 8000 }),
    ], { amount_paid: 1, status: "partially_paid" });
    const page = deriveCollections(e, NOW);
    assert.equal(page.nextPayable?.no, 0);
    const r = resolveInstallmentForEnrollment(e, NOW);
    assert.ok(r.ok);
    assert.equal(r.resolved.installmentNo, 1);
    assert.equal(r.resolved.matchesPageNextPayable, false, "the divergence must be surfaced to staff");
  });
});

describe("blocked cases", () => {
  test("no unpaid installment", () => {
    const e = enrollment([line({ no: 1, paid: true }), line({ no: 2, paid: true })], { status: "fully_paid" });
    const r = resolveInstallmentForEnrollment(e, NOW);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, "zero_balance");
  });

  test("zero balance on the next line blocks rather than sending 'Rs.0'", () => {
    const e = enrollment([line({ no: 1, paid: true }), line({ no: 2, amount: 0 })]);
    const r = resolveInstallmentForEnrollment(e, NOW);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, "zero_balance");
  });

  test("a payment attempt (nothing ever paid) is not an enrollment to chase", () => {
    const e = enrollment([line({ no: 1 })], { amount_paid: 0, status: "pending" });
    const r = resolveInstallmentForEnrollment(e, NOW);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, "no_active_enrollment");
  });

  test("a cancelled enrollment is never chased", () => {
    const e = enrollment([line({ no: 1 })], { amount_paid: 5000, status: "cancelled" });
    assert.equal(resolveInstallmentForEnrollment(e, NOW).ok, false);
  });
});

describe("a partially paid installment quotes only what is still owed", () => {
  test("outstanding is amount minus what was already received on that line", () => {
    const l = line({ no: 2, amount: 8000, paid_amount: 3000 });
    assert.equal(lineOutstanding(l), 5000);
    const e = enrollment([line({ no: 1, paid: true }), l]);
    const r = resolveInstallmentForEnrollment(e, NOW);
    assert.ok(r.ok);
    assert.equal(r.resolved.amountDue, 5000);
    assert.equal(installmentReminderVars(r.resolved).fee_in_rs, "5000");
  });

  test("a line paid in full but not yet closed blocks instead of sending Rs.0", () => {
    const e = enrollment([line({ no: 1, paid: true }), line({ no: 2, amount: 8000, paid_amount: 8000 })]);
    const r = resolveInstallmentForEnrollment(e, NOW);
    assert.equal(r.ok === false && r.reason, "zero_balance");
  });
});

describe("Fee_in_Rs formatting matches what the body implies", () => {
  test("digits only — the body already prints 'Rs.'", () => {
    assert.equal(formatFeeInRs(8000), "8000");
  });

  test("no thousands separator", () => {
    assert.equal(formatFeeInRs(125000), "125000");
    assert.ok(!formatFeeInRs(125000).includes(","));
  });

  test("no currency symbol — the rupee sign is blocked as non-GSM anyway", () => {
    for (const n of [500, 8000, 125000]) {
      assert.ok(!/[₹Rs]/.test(formatFeeInRs(n)));
    }
  });

  test("decimals appear only when the real data has them", () => {
    assert.equal(formatFeeInRs(8000), "8000");
    assert.equal(formatFeeInRs(8000.0), "8000");
    assert.equal(formatFeeInRs(8000.5), "8000.50");
    assert.equal(formatFeeInRs(8333.333), "8333.33");
  });

  test("the installment number is rendered as a plain integer", () => {
    const e = enrollment([line({ no: 1, paid: true }), line({ no: 2 })]);
    const r = resolveInstallmentForEnrollment(e, NOW);
    assert.ok(r.ok);
    assert.deepEqual(installmentReminderVars(r.resolved), { no_of_installment: "2", fee_in_rs: "8000" });
  });
});

describe("choosing between several enrollments", () => {
  test("the most overdue money wins, matching the collections worklist ordering", () => {
    const small = enrollment([line({ no: 1, paid: true }), line({ no: 2, amount: 1000 })], { id: "small" });
    const big = enrollment([line({ no: 1, paid: true }), line({ no: 2, amount: 40000 })], { id: "big" });
    assert.equal(pickReminderEnrollment([small, big], NOW)?.id, "big");
  });

  test("returns null when no enrollment can be chased", () => {
    const done = enrollment([line({ no: 1, paid: true })], { status: "fully_paid" });
    assert.equal(pickReminderEnrollment([done], NOW), null);
  });
});
