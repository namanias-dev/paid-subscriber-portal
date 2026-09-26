import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planCourseEnrollment } from "../../lib/installments";
import {
  analyzeBatches,
  batchLabelAddsDetail,
  batchPairKey,
  buildEnrollmentPaymentBody,
  checkoutAmountsDiffer,
  checkoutBatchError,
  defaultInstallmentCount,
  normalizePublicPaymentRequest,
  publicPaymentIntent,
  resolveBatchId,
  timingsForMode,
} from "../../lib/enrollmentCheckout";
import { enrollmentBackHref, isEnrollmentCheckoutPath } from "../../lib/enrollmentPath";
import { isWidgetAllowedPath } from "../../lib/ai-agent/conversationPolicy";
import { validateCoupon } from "../../lib/coupons";
import type { Course, CourseBatch, InstallmentItem } from "../../lib/types";

const BOOKING = "2026-09-26T04:30:00.000Z";

function emi(seat = 2000) {
  return {
    enabled: true,
    allow_full: true,
    allow_custom_seat: true,
    seat_amount: seat,
    min_seat_amount: seat,
    installment_counts: [3, 6],
    first_interval_days: 7,
    interval_months: 1,
  };
}

function batch(over: Partial<CourseBatch> & Pick<CourseBatch, "id" | "mode" | "timing" | "price">): CourseBatch {
  return {
    label: null,
    start_date: "2026-10-11T18:30:00.000Z",
    end_date: null,
    original_price: null,
    pay_in_full_price: null,
    emi_config: emi(),
    capacity: null,
    seats_left: 20,
    ...over,
  };
}

function course(batches: CourseBatch[], over: Partial<Course> = {}): Course {
  return {
    id: "co-1",
    slug: "safalta",
    title: "SAFALTA",
    price: batches[0]?.price ?? 1,
    batches,
    default_batch_id: batches[0]?.id ?? null,
    emi_config: emi(),
    coupons: [{ code: "SAVE10", type: "percent", value: 10, active: true, expires_at: null, max_uses: null, used: 0 }],
    ...over,
  } as unknown as Course;
}

function sum(schedule: InstallmentItem[]): number {
  return schedule.reduce((a, s) => a + s.amount, 0);
}

const offlineMorning = batch({ id: "off-m", mode: "Offline", timing: "Morning", price: 85000, original_price: 100000, pay_in_full_price: 70000 });
const offlineEvening = batch({ id: "off-e", mode: "Offline", timing: "Evening", price: 85000, original_price: 100000, pay_in_full_price: 70000 });
const onlineMorning = batch({ id: "on-m", mode: "Online", timing: "Morning", price: 55000, original_price: 65000, pay_in_full_price: 55000 });
const onlineEvening = batch({ id: "on-e", mode: "Online", timing: "Evening", price: 55000, original_price: 65000, pay_in_full_price: 50000 });

describe("enrollment paths stay scoped to checkout", () => {
  test("course enroll and legacy enroll resolve back to the course", () => {
    assert.equal(enrollmentBackHref("/courses/safalta/enroll"), "/courses/safalta");
    assert.equal(enrollmentBackHref("/courses/safalta/enroll/"), "/courses/safalta");
    assert.equal(enrollmentBackHref("/enroll/safalta"), "/courses/safalta");
    assert.equal(enrollmentBackHref("/courses/safalta"), null);
    assert.equal(enrollmentBackHref("/courses"), null);
    assert.equal(isEnrollmentCheckoutPath("/courses/safalta/enroll?utm_source=ig&fbclid=abc"), true);
    assert.equal(isEnrollmentCheckoutPath("/notes"), false);
  });

  test("the counsellor widget is hidden on checkout and stays on the course page", () => {
    assert.equal(isWidgetAllowedPath("/courses/safalta/enroll"), false);
    assert.equal(isWidgetAllowedPath("/enroll/safalta"), false);
    assert.equal(isWidgetAllowedPath("/courses/safalta"), true);
    assert.equal(isWidgetAllowedPath("/courses"), true);
    assert.equal(isWidgetAllowedPath("/payment/status"), false);
  });
});

describe("batch selection maps onto real batch ids", () => {
  test("mode and timing come from batches that exist, including a missing combination", () => {
    const model = analyzeBatches([offlineMorning, offlineEvening, onlineMorning]);
    assert.equal(model.kind, "matrix");
    if (model.kind !== "matrix") return;
    assert.deepEqual(model.modes, ["Offline", "Online"]);
    assert.deepEqual(model.timings, ["Morning", "Evening"]);
    assert.deepEqual(timingsForMode(model, "Online"), ["Morning"]);
    assert.equal(model.pairToId.get(batchPairKey("Offline", "Evening")), "off-e");
    assert.equal(resolveBatchId(model, "Online", "Evening"), "on-m");
    assert.equal(resolveBatchId(model, "Offline", "Morning"), "off-m");
  });

  test("an extra batch type stays selectable instead of being dropped", () => {
    const recorded = batch({ id: "rec", mode: "Recorded", timing: "Weekend", price: 40000 });
    const model = analyzeBatches([offlineMorning, recorded]);
    assert.equal(model.kind, "matrix");
    if (model.kind !== "matrix") return;
    assert.deepEqual(model.modes, ["Offline", "Recorded"]);
    assert.equal(resolveBatchId(model, "Recorded", "Weekend"), "rec");
  });

  test("a batch label that only restates mode, timing, and start date is not repeated", () => {
    assert.equal(batchLabelAddsDetail("Starts 12 Oct 2026 · Offline · Morning", "Offline · Morning", "Starts 12 Oct 2026"), false);
    assert.equal(batchLabelAddsDetail("Offline · Morning", "Offline · Morning", "Starts 12 Oct 2026"), false);
    assert.equal(batchLabelAddsDetail("Delhi Centre · Offline · Morning", "Offline · Morning", "Starts 12 Oct 2026"), true);
    assert.equal(batchLabelAddsDetail(null, "Offline · Morning", null), false);
  });

  test("only offline, only morning, and a missing pair never invent a selectable combination", () => {
    const onlyOffline = analyzeBatches([offlineMorning, offlineEvening]);
    assert.equal(onlyOffline.kind, "matrix");
    if (onlyOffline.kind !== "matrix") return;
    assert.deepEqual(onlyOffline.modes, ["Offline"]);
    assert.equal(resolveBatchId(onlyOffline, "Online", "Evening"), null);

    const onlyMorning = analyzeBatches([offlineMorning, onlineMorning]);
    assert.equal(onlyMorning.kind, "matrix");
    if (onlyMorning.kind !== "matrix") return;
    assert.deepEqual(timingsForMode(onlyMorning, "Online"), ["Morning"]);
    assert.equal(resolveBatchId(onlyMorning, "Online", "Evening"), "on-m");
    assert.equal(resolveBatchId(onlyMorning, "Online", "Morning"), "on-m");

    const missingEvening = analyzeBatches([offlineMorning, offlineEvening, onlineMorning]);
    assert.equal(missingEvening.kind, "matrix");
    if (missingEvening.kind !== "matrix") return;
    assert.deepEqual(timingsForMode(missingEvening, "Online"), ["Morning"]);
    assert.equal(resolveBatchId(missingEvening, "Online", "Evening"), "on-m");
  });

  test("duplicate pairs and legacy multi-value batches fall back to the batch list", () => {
    const dup = batch({ id: "dup", mode: "Offline", timing: "Morning", price: 85000 });
    assert.equal(analyzeBatches([offlineMorning, dup]).kind, "list");
    const legacy = batch({ id: "leg", mode: ["Online", "Offline"], timing: "Morning", price: 85000 });
    assert.equal(analyzeBatches([offlineMorning, legacy]).kind, "list");
  });
});

describe("installment default and payment bodies preserve the checkout contract", () => {
  test("installment count default stays the existing second option", () => {
    assert.equal(defaultInstallmentCount([3, 6, 10]), 6);
    assert.equal(defaultInstallmentCount([3]), 3);
    assert.equal(defaultInstallmentCount([]), 6);
  });

  test("seat plus installments, custom seat, pay in full, and coupon payloads", () => {
    const c = course([offlineMorning, offlineEvening, onlineMorning]);

    const seat = planCourseEnrollment({
      course: c, plan: "emi", bookSeat: true, installmentCount: 3, batchId: "off-m", bookingISO: BOOKING,
    });
    assert.equal(seat.ok, true);
    if (!seat.ok) return;
    assert.equal(seat.plan.firstAmount, 2000);
    assert.equal(seat.plan.firstKind, "seat");
    assert.equal(seat.plan.totalFee, 85000);
    assert.equal(sum(seat.plan.schedule), 85000);
    const lines = seat.plan.schedule.filter((s) => s.kind === "installment");
    assert.equal(lines.length, 3);
    assert.equal(lines[0].amount + lines[1].amount + lines[2].amount, 83000);
    assert.equal(lines[2].amount, lines[0].amount + (83000 - lines[0].amount * 3));
    assert.ok(lines[0].due);

    const custom = planCourseEnrollment({
      course: c, plan: "emi", bookSeat: true, seatAmount: 5000, installmentCount: 3, batchId: "off-e", bookingISO: BOOKING,
    });
    assert.equal(custom.ok, true);
    if (!custom.ok) return;
    assert.equal(custom.plan.firstAmount, 5000);
    assert.equal(sum(custom.plan.schedule), 85000);

    const fullNow = planCourseEnrollment({
      course: c, plan: "full", bookSeat: false, batchId: "on-m", bookingISO: BOOKING,
    });
    assert.equal(fullNow.ok, true);
    if (!fullNow.ok) return;
    assert.equal(fullNow.plan.firstAmount, 55000);
    assert.equal(fullNow.plan.totalFee, 55000);
    assert.equal(fullNow.plan.schedule.length, 1);

    const fullSeat = planCourseEnrollment({
      course: c, plan: "full", bookSeat: true, batchId: "off-m", bookingISO: BOOKING,
    });
    assert.equal(fullSeat.ok, true);
    if (!fullSeat.ok) return;
    assert.equal(fullSeat.plan.firstAmount, 2000);
    assert.equal(fullSeat.plan.totalFee, 70000);
    assert.equal(sum(fullSeat.plan.schedule), 70000);

    const wire = JSON.parse(JSON.stringify(buildEnrollmentPaymentBody({
      courseSlug: "safalta",
      name: "  Naman  ",
      email: " a@b.co ",
      mobile: "9812345678",
      plan: "emi",
      bookSeat: true,
      installmentCount: 3,
      seatAmount: 5000,
      allowCustomSeat: true,
      multiBatch: true,
      batchId: "off-m",
      gaClientId: "GA1.1.1.1",
      expectedAmount: 5000,
    }))) as Record<string, unknown>;
    assert.deepEqual(wire, {
      courseSlug: "safalta",
      name: "Naman",
      email: "a@b.co",
      mobile: "9812345678",
      plan: "emi",
      bookSeat: true,
      installmentCount: 3,
      seatAmount: 5000,
      batchId: "off-m",
      gaClientId: "GA1.1.1.1",
      expectedAmount: 5000,
    });

    const fullWire = JSON.parse(JSON.stringify(buildEnrollmentPaymentBody({
      courseSlug: "safalta",
      name: "Naman",
      email: "",
      mobile: "9812345678",
      plan: "full",
      bookSeat: false,
      installmentCount: 3,
      seatAmount: 5000,
      allowCustomSeat: true,
      multiBatch: false,
      batchId: "off-m",
      expectedAmount: 50000,
    }))) as Record<string, unknown>;
    assert.equal(fullWire.plan, "full");
    assert.equal(fullWire.bookSeat, false);
    assert.equal("installmentCount" in fullWire, false);
    assert.equal("seatAmount" in fullWire, false);
    assert.equal("batchId" in fullWire, false);
    assert.equal(fullWire.expectedAmount, 50000);

    const coupon = validateCoupon(c.coupons, "SAVE10", seat.plan.totalFee);
    assert.equal(coupon.ok, true);
    const couponWire = JSON.parse(JSON.stringify(buildEnrollmentPaymentBody({
      courseSlug: "safalta",
      name: "Naman",
      email: "",
      mobile: "9812345678",
      plan: "emi",
      bookSeat: true,
      installmentCount: 3,
      seatAmount: 2000,
      allowCustomSeat: false,
      multiBatch: true,
      batchId: "off-m",
      couponCode: coupon.ok ? coupon.coupon.code : "SAVE10",
      expectedAmount: 2000,
    }))) as Record<string, unknown>;
    assert.equal(couponWire.couponCode, "SAVE10");
    assert.equal(couponWire.expectedAmount, 2000);
    assert.equal("seatAmount" in couponWire, false);
    assert.equal("discount" in couponWire, false);
  });

  test("public checkout maps installments to a reservation and pay in full to the amount due now", () => {
    assert.deepEqual(
      publicPaymentIntent({ method: "installments", seatConfigured: true, allowCustomSeat: true, reservationAmount: 5000 }),
      { plan: "emi", bookSeat: true, seatAmount: 5000 },
    );
    assert.deepEqual(
      publicPaymentIntent({ method: "installments", seatConfigured: true, allowCustomSeat: false, reservationAmount: 5000 }),
      { plan: "emi", bookSeat: true },
    );
    assert.deepEqual(
      publicPaymentIntent({ method: "installments", seatConfigured: false, allowCustomSeat: false, reservationAmount: 5000 }),
      { plan: "emi", bookSeat: false },
    );
    assert.deepEqual(
      publicPaymentIntent({ method: "full", seatConfigured: true, allowCustomSeat: true, reservationAmount: 5000 }),
      { plan: "full", bookSeat: false },
    );
  });

  test("every current SAFALTA batch shape balances through the planner", () => {
    const shapes = [offlineMorning, offlineEvening, onlineMorning, onlineEvening];
    const c = course(shapes, { emi_config: emi(2000) });
    for (const item of shapes) {
      const seat = planCourseEnrollment({
        course: c, plan: "emi", bookSeat: true, seatAmount: 2000, installmentCount: 3, batchId: item.id, bookingISO: BOOKING,
      });
      assert.equal(seat.ok, true, item.id);
      if (!seat.ok) continue;
      const later = seat.plan.schedule.filter((line) => line.kind === "installment");
      assert.equal(seat.plan.firstAmount + later.reduce((a, line) => a + line.amount, 0), seat.plan.totalFee);
      assert.equal(sum(seat.plan.schedule), seat.plan.totalFee);
      assert.equal(seat.plan.totalFee - seat.plan.firstAmount, seat.plan.totalFee - 2000);
      assert.equal(seat.plan.firstAmount, 2000);
      assert.equal(seat.plan.totalFee, item.price);

      const custom = planCourseEnrollment({
        course: c, plan: "emi", bookSeat: true, seatAmount: 5000, installmentCount: 3, batchId: item.id, bookingISO: BOOKING,
      });
      assert.equal(custom.ok, true, item.id);
      if (!custom.ok) continue;
      const customLater = custom.plan.schedule.filter((line) => line.kind === "installment");
      assert.equal(custom.plan.firstAmount, 5000);
      assert.equal(custom.plan.firstAmount + customLater.reduce((a, line) => a + line.amount, 0), custom.plan.totalFee);
      assert.equal(custom.plan.totalFee - custom.plan.firstAmount, item.price - 5000);

      const full = planCourseEnrollment({
        course: c, plan: "full", bookSeat: false, batchId: item.id, bookingISO: BOOKING,
      });
      assert.equal(full.ok, true, item.id);
      if (!full.ok) continue;
      const fullPrice = item.pay_in_full_price ?? item.price;
      assert.equal(full.plan.firstAmount, fullPrice);
      assert.equal(full.plan.totalFee, fullPrice);
      assert.equal(full.plan.totalFee - full.plan.firstAmount, 0);
      assert.equal(full.plan.schedule.some((line) => line.kind === "installment"), false);

      const wire = JSON.parse(JSON.stringify(buildEnrollmentPaymentBody({
        courseSlug: "safalta",
        name: "Naman",
        email: "",
        mobile: "9812345678",
        plan: "full",
        bookSeat: false,
        installmentCount: 3,
        seatAmount: 2000,
        allowCustomSeat: true,
        multiBatch: true,
        batchId: item.id,
        expectedAmount: full.plan.firstAmount,
      }))) as Record<string, unknown>;
      assert.equal(wire.expectedAmount, fullPrice);
      assert.equal("installmentCount" in wire, false);
      assert.equal("seatAmount" in wire, false);

      const save = item.price - fullPrice;
      assert.equal(save > 0, item.price > fullPrice);
      if (item.id === "on-m") assert.equal(save, 0);
    }
  });

  test("a seat below the minimum is clamped by the planner and disagrees with the typed quote", () => {
    const c = course([offlineMorning]);
    const low = planCourseEnrollment({
      course: c, plan: "emi", bookSeat: true, seatAmount: 500, installmentCount: 3, batchId: "off-m", bookingISO: BOOKING,
    });
    assert.equal(low.ok, true);
    if (!low.ok) return;
    assert.equal(low.plan.firstAmount, 2000);
    assert.equal(checkoutAmountsDiffer(500, low.plan.firstAmount), true);

    const high = planCourseEnrollment({
      course: c, plan: "emi", bookSeat: true, seatAmount: 90000, installmentCount: 3, batchId: "off-m", bookingISO: BOOKING,
    });
    assert.equal(high.ok, true);
    if (!high.ok) return;
    assert.ok(high.plan.firstAmount < 85000);
    assert.equal(checkoutAmountsDiffer(90000, high.plan.firstAmount), true);
  });

  test("public create-payment rejects a bad plan, a seat on pay in full, and an unknown batch", () => {
    assert.equal(normalizePublicPaymentRequest({ plan: "nope" }).ok, false);
    assert.deepEqual(
      normalizePublicPaymentRequest({ plan: "full", bookSeat: false }),
      { ok: true, plan: "full", bookSeat: false },
    );
    const withSeat = normalizePublicPaymentRequest({ plan: "full", bookSeat: true, seatAmount: 2000 });
    assert.equal(withSeat.ok, false);
    const seatOnly = normalizePublicPaymentRequest({ plan: "full", seatAmount: 2000 });
    assert.equal(seatOnly.ok, false);
    assert.deepEqual(
      normalizePublicPaymentRequest({ plan: "emi", bookSeat: true }),
      { ok: true, plan: "emi", bookSeat: true },
    );

    const batches = [{ id: "off-m" }, { id: "on-m" }];
    assert.equal(checkoutBatchError(batches, "missing"), "Please choose a batch.");
    assert.equal(checkoutBatchError(batches, null), "Please choose a batch.");
    assert.equal(checkoutBatchError(batches, "off-m"), null);
    assert.equal(checkoutBatchError([{ id: "only" }], null), null);
    assert.equal(checkoutBatchError([{ id: "only" }], "other"), "Please choose a batch.");
  });

  test("invalid installment count and unsupported EMI are refused by the planner", () => {
    const c = course([offlineMorning]);
    const badCount = planCourseEnrollment({
      course: c, plan: "emi", bookSeat: true, installmentCount: 9, batchId: "off-m", bookingISO: BOOKING,
    });
    assert.equal(badCount.ok, false);
    const disabled = { ...emi(), enabled: false };
    const noEmi = course(
      [batch({ id: "plain", mode: "Offline", timing: "Morning", price: 10000, emi_config: disabled })],
      { emi_config: disabled },
    );
    const refused = planCourseEnrollment({ course: noEmi, plan: "emi", bookSeat: true, installmentCount: 3, bookingISO: BOOKING });
    assert.equal(refused.ok, false);
  });

  test("a stale quoted amount is a conflict and a missing quote is not", () => {
    assert.equal(checkoutAmountsDiffer(undefined, 2000), false);
    assert.equal(checkoutAmountsDiffer("", 2000), false);
    assert.equal(checkoutAmountsDiffer(2000, 2000), false);
    assert.equal(checkoutAmountsDiffer("2000", 2000), false);
    assert.equal(checkoutAmountsDiffer(1500, 2000), true);
    assert.equal(checkoutAmountsDiffer("nope", 2000), true);
  });
});

describe("checkout UI does not hardcode production prices", () => {
  test("enrollment presentation and payload helper stay free of fixed fees", () => {
    const files = [
      "components/public/CheckoutClient.tsx",
      "components/public/enrollment/parts.tsx",
      "lib/enrollmentCheckout.ts",
    ];
    const banned = ["70000", "75000", "55000", "50000", "45000", "85000", "2000", "₹2,000", "₹70,000"];
    for (const file of files) {
      const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      for (const token of banned) {
        assert.equal(src.includes(token), false, `${file} contains ${token}`);
      }
    }
    const client = readFileSync(new URL("../../components/public/CheckoutClient.tsx", import.meta.url), "utf8");
    assert.match(client, /planCourseEnrollment/);
    assert.match(client, /publicPaymentIntent/);
    assert.match(client, /Installment plan total/);
    assert.match(client, /Pay-in-full price/);
    assert.match(client, /Minimum amount is/);
    assert.match(client, /scrollPaddingBottom/);
    assert.doesNotMatch(client, /Course fee/);
    const status = readFileSync(new URL("../../app/(site)/payment/status/StatusClient.tsx", import.meta.url), "utf8");
    assert.match(status, /Your seat is reserved/);
    assert.match(status, /Enrollment confirmed/);
    assert.match(status, /Payment not completed yet/);
    assert.match(status, /enr\.remaining <= 0/);
    assert.match(status, /!purchaseFired\.current && isPaid/);
    assert.doesNotMatch(client, /Start the payment plan today/);
    assert.doesNotMatch(client, /Pay the full /);
    assert.match(client, /\/api\/v1\/enroll\/create-payment/);
    assert.match(client, /\/api\/v1\/coupons\/validate/);
    assert.match(client, /click_enroll/);
    assert.match(client, /payment_start/);
    assert.match(client, /course_view/);
    const route = readFileSync(new URL("../../app/api/v1/enroll/create-payment/route.ts", import.meta.url), "utf8");
    assert.match(route, /checkoutAmountsDiffer/);
    assert.match(route, /Course pricing has been updated/);
    assert.match(route, /planCourseEnrollment/);
  });
});
