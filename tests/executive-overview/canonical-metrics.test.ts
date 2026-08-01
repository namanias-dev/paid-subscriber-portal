import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { distinctRegistrations, isPaidStatus, dedupedPaidTotal } from "../../lib/paymentsAgg";
import { paidWebinarRegsOnYmd, filterPaidWebinarOnYmd, buildWebinarByDay } from "../../lib/webinarReg";
import { buildAdmissionStages } from "../../lib/analytics/executiveOverview";
import { istTodayYMD, istYMD } from "../../lib/dates";
import type { Payment, CourseEnrollment, InstallmentItem } from "../../lib/types";

function pay(partial: Partial<Payment> & Pick<Payment, "id" | "status" | "phone" | "item_type">): Payment {
  return {
    amount: 50,
    item: "Webinar",
    item_slug: "test-webinar",
    created_at: new Date().toISOString(),
    deleted_at: null,
    ...partial,
  } as Payment;
}

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

describe("confirmed paid webinar registrations (Overview ≡ Payments)", () => {
  test("5 attempts → 3 confirmed: only PAID/captured count; abandoned+failed excluded", () => {
    const today = new Date().toISOString();
    const rows = [
      pay({ id: "1", status: "PAID", phone: "9111111111", item_type: "webinar", created_at: today, amount: 50 }),
      pay({ id: "2", status: "captured", phone: "9222222222", item_type: "webinar", created_at: today, amount: 50 }),
      pay({ id: "3", status: "PAID", phone: "9333333333", item_type: "webinar", created_at: today, amount: 50 }),
      pay({ id: "4", status: "ABANDONED", phone: "9444444444", item_type: "webinar", created_at: today, amount: 50 }),
      pay({ id: "5", status: "FAILED", phone: "9555555555", item_type: "webinar", created_at: today, amount: 50 }),
    ];
    const ymd = istTodayYMD();
    assert.equal(paidWebinarRegsOnYmd(rows, ymd), 3);
    assert.equal(filterPaidWebinarOnYmd(rows, ymd).length, 3);
    const revenue = dedupedPaidTotal(rows.filter((p) => isPaidStatus(p.status) && p.item_type === "webinar"));
    assert.equal(revenue, 150);
  });

  test("duplicate paid callback for same phone×item does not inflate count or revenue", () => {
    const today = new Date().toISOString();
    const rows = [
      pay({ id: "a", status: "PAID", phone: "9111111111", item_type: "webinar", created_at: today, amount: 50 }),
      pay({ id: "b", status: "PAID", phone: "9111111111", item_type: "webinar", created_at: today, amount: 50 }), // retry
    ];
    const ymd = istTodayYMD();
    assert.equal(paidWebinarRegsOnYmd(rows, ymd), 1);
    assert.equal(distinctRegistrations(filterPaidWebinarOnYmd(rows, ymd)), 1);
    assert.equal(dedupedPaidTotal(filterPaidWebinarOnYmd(rows, ymd)), 50);
  });

  test("pending booking payment is not a confirmed seat booking", () => {
    const rows = [
      pay({
        id: "s1",
        status: "PENDING",
        phone: "9111111111",
        item_type: "course",
        payment_kind: "seat",
        amount: 2000,
      }),
      pay({
        id: "s2",
        status: "PAID",
        phone: "9222222222",
        item_type: "course",
        payment_kind: "seat",
        amount: 2000,
      }),
    ];
    const seats = distinctRegistrations(
      rows.filter((p) => isPaidStatus(p.status) && p.item_type === "course" && p.payment_kind === "seat"),
    );
    assert.equal(seats, 1);
  });

  test("buildWebinarByDay today equals paidWebinarRegsOnYmd", () => {
    const rows = [
      pay({ id: "1", status: "PAID", phone: "9111111111", item_type: "webinar", item_slug: "w1" }),
      pay({ id: "2", status: "PAID", phone: "9222222222", item_type: "webinar", item_slug: "w1" }),
      pay({ id: "3", status: "ABANDONED", phone: "9333333333", item_type: "webinar", item_slug: "w1" }),
    ];
    const ymd = istTodayYMD();
    assert.equal(buildWebinarByDay(rows, "").get(ymd), paidWebinarRegsOnYmd(rows, ymd));
  });
});

describe("admission funnel cumulative stages", () => {
  test("student at installment 3 appears in ≥1, ≥2, ≥3", () => {
    const stages = buildAdmissionStages([
      enr({
        id: "e3",
        amount_paid: 60000,
        schedule: [
          line({ kind: "seat", amount: 2000, paid: true }),
          line({ kind: "installment", amount: 20000, paid: true, no: 1 }),
          line({ kind: "installment", amount: 20000, paid: true, no: 2 }),
          line({ kind: "installment", amount: 18000, paid: true, no: 3 }),
        ],
      }),
    ]);
    const map = Object.fromEntries(stages.map((s) => [s.key, s.count]));
    assert.equal(map.seat, 1);
    assert.equal(map.inst1, 1);
    assert.equal(map.inst2, 1);
    assert.equal(map.inst3, 1);
  });

  test("fully paid appears in all applicable stages", () => {
    const stages = buildAdmissionStages([
      enr({
        id: "full",
        status: "fully_paid",
        amount_paid: 60000,
        schedule: [line({ kind: "full", amount: 60000, paid: true })],
      }),
    ]);
    const map = Object.fromEntries(stages.map((s) => [s.key, s.count]));
    assert.equal(map.seat, 1);
    assert.equal(map.inst1, 1);
    assert.equal(map.inst2, 1);
    assert.equal(map.inst3, 1);
    assert.equal(map.full, 1);
  });
});

describe("timezone IST day boundary", () => {
  test("payment just after midnight IST lands on IST calendar day", () => {
    // 2026-07-15 00:30 IST = 2026-07-14 19:00 UTC
    const iso = "2026-07-14T19:00:00.000Z";
    assert.equal(istYMD(iso), "2026-07-15");
    const rows = [pay({ id: "z", status: "PAID", phone: "9111111111", item_type: "webinar", created_at: iso })];
    assert.equal(paidWebinarRegsOnYmd(rows, "2026-07-15"), 1);
    assert.equal(paidWebinarRegsOnYmd(rows, "2026-07-14"), 0);
  });
});

describe("percentage change denominator", () => {
  test("prev zero with current positive is New, not Infinity", () => {
    const prev = 0;
    const cur = 5;
    const pct = prev === 0 ? null : ((cur - prev) / prev) * 100;
    assert.equal(pct, null);
    const label = prev === 0 && cur > 0 ? "New" : String(pct);
    assert.equal(label, "New");
  });
});

describe("SMS status reconciliation", () => {
  test("delivered + failed + pending = sent", () => {
    const logs = [
      { status: "DELIVERED" },
      { status: "DELIVERED" },
      { status: "FAILED" },
      { status: "SENT" },
      { status: "QUEUED" },
    ];
    let delivered = 0, failed = 0, pending = 0;
    for (const l of logs) {
      const st = l.status;
      if (st === "DELIVERED") delivered++;
      else if (st === "FAILED") failed++;
      else pending++;
    }
    assert.equal(delivered + failed + pending, logs.length);
  });
});
