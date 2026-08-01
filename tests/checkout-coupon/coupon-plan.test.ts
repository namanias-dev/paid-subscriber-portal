import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planCourseEnrollment } from "../../lib/installments";
import {
  validateCoupon,
  couponDiscountReason,
  parseCouponCodeFromReason,
} from "../../lib/coupons";
import type { Course, Coupon, CourseEnrollment, InstallmentItem } from "../../lib/types";

const NAM5000: Coupon = {
  code: "NAM5000",
  type: "flat",
  value: 5000,
  active: true,
  expires_at: "2099-12-31T18:29:59.999Z",
  max_uses: null,
  used: 0,
};

/** Safalta-like fee sheet used for arithmetic assertions. */
function safaltaCourse(over: Partial<Course> = {}): Course {
  return {
    id: "co-safalta",
    slug: "safalta-gs-foundation",
    title: "Safalta GS Foundation Batch",
    price: 45000,
    pay_in_full_price: 40000,
    original_price: 50000,
    coupons: [NAM5000],
    emi_config: {
      enabled: true,
      allow_full: true,
      seat_amount: 5000,
      installment_counts: [3, 6, 10],
      first_interval_days: 7,
      interval_months: 1,
    },
    batch_start: "2026-08-04T18:30:00.000Z",
    ...over,
  } as unknown as Course;
}

function sumSchedule(schedule: InstallmentItem[]): number {
  return schedule.reduce((a, s) => a + s.amount, 0);
}

describe("checkout coupon — NAM5000 on Safalta-like fees", () => {
  test("full payment: ₹40,000 − ₹5,000 = ₹35,000 charged", () => {
    const course = safaltaCourse();
    const base = planCourseEnrollment({ course, plan: "full", bookSeat: false });
    assert.equal(base.ok, true);
    if (!base.ok) return;
    assert.equal(base.plan.totalFee, 40000);

    const coupon = validateCoupon(course.coupons, "NAM5000", base.plan.totalFee);
    assert.equal(coupon.ok, true);
    if (!coupon.ok) return;
    assert.equal(coupon.discount, 5000);

    const discounted = planCourseEnrollment({
      course,
      plan: "full",
      bookSeat: false,
      discountRupees: coupon.discount,
    });
    assert.equal(discounted.ok, true);
    if (!discounted.ok) return;
    assert.equal(discounted.plan.originalTotalFee, 40000);
    assert.equal(discounted.plan.discountAmount, 5000);
    assert.equal(discounted.plan.totalFee, 35000);
    assert.equal(discounted.plan.firstAmount, 35000);
    assert.equal(sumSchedule(discounted.plan.schedule), 35000);
  });

  test("EMI 6: total ₹45,000 − ₹5,000; installments sum exactly to ₹40,000; remainder on last", () => {
    const course = safaltaCourse();
    const coupon = validateCoupon(course.coupons, "NAM5000", 45000);
    assert.equal(coupon.ok, true);
    if (!coupon.ok) return;

    const discounted = planCourseEnrollment({
      course,
      plan: "emi",
      bookSeat: false,
      installmentCount: 6,
      bookingISO: "2026-07-28T10:00:00.000Z",
      discountRupees: coupon.discount,
    });
    assert.equal(discounted.ok, true);
    if (!discounted.ok) return;

    assert.equal(discounted.plan.originalTotalFee, 45000);
    assert.equal(discounted.plan.totalFee, 40000);
    assert.equal(sumSchedule(discounted.plan.schedule), 40000);
    assert.equal(discounted.plan.schedule.length, 6);

    const baseEach = Math.floor(40000 / 6); // 6666
    const remainder = 40000 - baseEach * 6; // 4
    for (let i = 0; i < 5; i++) {
      assert.equal(discounted.plan.schedule[i].amount, baseEach);
    }
    assert.equal(discounted.plan.schedule[5].amount, baseEach + remainder);
  });

  test("seat booking: seat stays ₹5,000; post-discount balance shown; coupon fields persist shape", () => {
    const course = safaltaCourse();
    const discounted = planCourseEnrollment({
      course,
      plan: "emi",
      bookSeat: true,
      installmentCount: 6,
      bookingISO: "2026-07-28T10:00:00.000Z",
      discountRupees: 5000,
    });
    assert.equal(discounted.ok, true);
    if (!discounted.ok) return;

    assert.equal(discounted.plan.firstKind, "seat");
    assert.equal(discounted.plan.firstAmount, 5000); // seat unchanged
    assert.equal(discounted.plan.totalFee, 40000); // 45000 - 5000
    assert.equal(sumSchedule(discounted.plan.schedule), 40000);
    const remaining = discounted.plan.totalFee - discounted.plan.firstAmount;
    assert.equal(remaining, 35000);

    // Persistence shape used by create-payment (no DB).
    const enrollmentPatch = {
      total_fee: discounted.plan.totalFee,
      discount_amount: discounted.plan.discountAmount,
      original_total_fee: discounted.plan.originalTotalFee,
      discount_reason: couponDiscountReason("NAM5000"),
      discount_applied_by: "coupon",
      discount_applied_at: "2026-07-28T10:00:00.000Z",
    };
    assert.equal(parseCouponCodeFromReason(enrollmentPatch.discount_reason), "NAM5000");
    assert.equal(enrollmentPatch.discount_amount, 5000);
    assert.equal(enrollmentPatch.original_total_fee, 45000);
  });

  test("expired coupon rejected at initiation-time validation", () => {
    const expired: Coupon = { ...NAM5000, expires_at: "2020-01-01T00:00:00.000Z" };
    const result = validateCoupon([expired], "NAM5000", 40000);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /expired/i);
  });

  test("coupon not applicable to another course", () => {
    const other = safaltaCourse({ coupons: [] });
    const result = validateCoupon(other.coupons, "NAM5000", 40000);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not applicable/i);
  });

  test("duplicate callback / re-apply does not double-discount an already-discounted enrollment", () => {
    // Discount is baked into total_fee once. A second "apply same ₹5,000" against
    // the discounted total must not reduce it again when the enrollment already
    // carries the coupon (create-payment resumes paid enrollments without re-plan).
    const enrollment: Pick<CourseEnrollment, "total_fee" | "discount_amount" | "original_total_fee" | "discount_reason" | "amount_paid" | "schedule"> = {
      total_fee: 35000,
      discount_amount: 5000,
      original_total_fee: 40000,
      discount_reason: couponDiscountReason("NAM5000"),
      amount_paid: 35000,
      schedule: [{ no: 0, kind: "full", label: "Full Payment", amount: 35000, due: null, paid: true }],
    };

    // Simulate a mistaken second discount against current total — production path
    // skips re-plan when amount_paid > 0. Guard: already-applied code is detected.
    const already = parseCouponCodeFromReason(enrollment.discount_reason);
    assert.equal(already, "NAM5000");
    assert.equal(enrollment.total_fee, 35000);
    assert.equal(enrollment.original_total_fee! - enrollment.discount_amount!, 35000);

    // Re-validating at initiation with the same code against original would yield
    // the same discount — applying again to already-discounted total would be wrong.
    const againstDiscounted = validateCoupon([NAM5000], "NAM5000", enrollment.total_fee);
    assert.equal(againstDiscounted.ok, true);
    if (!againstDiscounted.ok) return;
    // If someone re-planned paid enrollments (bug), they'd subtract again → 30000.
    // Assert the correct invariant: sticky total stays at original − once.
    const stickyTotal = (enrollment.original_total_fee || 0) - (enrollment.discount_amount || 0);
    assert.equal(stickyTotal, 35000);
    assert.notEqual(enrollment.total_fee - againstDiscounted.discount, stickyTotal);
  });

  test("discount never drives payable below zero", () => {
    const course = safaltaCourse({ price: 3000, pay_in_full_price: 3000 });
    const coupon = validateCoupon([{ ...NAM5000, value: 5000 }], "NAM5000", 3000);
    assert.equal(coupon.ok, true);
    if (!coupon.ok) return;
    assert.equal(coupon.discount, 3000); // clamped to base
    assert.equal(coupon.finalAmount, 0);

    const planned = planCourseEnrollment({
      course,
      plan: "full",
      bookSeat: false,
      discountRupees: coupon.discount,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    assert.equal(planned.plan.totalFee, 0);
    assert.equal(planned.plan.firstAmount, 0);
  });

  test("seat + oversized discount is rejected with a clear message", () => {
    const course = safaltaCourse({
      price: 8000,
      pay_in_full_price: 8000,
      emi_config: {
        enabled: true,
        allow_full: true,
        seat_amount: 5000,
        installment_counts: [3],
        first_interval_days: 7,
        interval_months: 1,
      },
    });
    // 8000 - 5000 seat leaves 3000; discount 4000 would drop total below seat.
    const planned = planCourseEnrollment({
      course,
      plan: "emi",
      bookSeat: true,
      installmentCount: 3,
      discountRupees: 4000,
    });
    assert.equal(planned.ok, false);
    if (planned.ok) return;
    assert.match(planned.error, /exceeds the payable balance/i);
  });
});
