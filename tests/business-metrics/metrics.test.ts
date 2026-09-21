import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CourseEnrollment, Payment } from "../../lib/types";
import {
  collectionsReconcile,
  computeAdmissions,
  computeCollections,
  computePeople,
  istDayWindow,
} from "../../lib/analytics/businessMetrics";
import { dailyBusinessLines, monthlyBusinessHtml } from "../../lib/telegram/reports/businessFormat";
import { resolveMonthlyReportSlot } from "../../lib/telegram/reports/monthlySchedule";

const DAY = istDayWindow("2026-09-21");
const AT = "2026-09-21T04:30:00.000Z"; // 10:00 IST

function pay(partial: Partial<Payment> & Pick<Payment, "id" | "phone" | "amount" | "status">): Payment {
  return {
    student_name: "Student",
    item: "GS Foundation",
    item_type: "course",
    razorpay_payment_id: null,
    mode: null,
    created_at: AT,
    payment_kind: "full",
    status: "PAID",
    ...partial,
  } as Payment;
}

describe("collections — real money only, IST, deduped, reconciled", () => {
  const staff = new Set(["9999999999"]);
  const rows: Payment[] = [
    pay({ id: "a", phone: "9000000001", amount: 2000, payment_kind: "seat" }),
    pay({ id: "b", phone: "9000000002", amount: 10000, payment_kind: "installment", installment_no: 2 }),
    pay({ id: "c", phone: "9000000003", amount: 40000, payment_kind: "full" }),
    pay({ id: "d", phone: "9000000004", amount: 20000, status: "FAILED" }),
    pay({ id: "e", phone: "9000000005", amount: 15000, status: "PENDING" }),
    pay({ id: "f1", phone: "9000000006", amount: 5000, payment_kind: "full", reference_no: "NAMAN-1" }),
    pay({ id: "f2", phone: "9000000006", amount: 5000, payment_kind: "full", reference_no: "NAMAN-1-retry" }),
    pay({ id: "g", phone: "9000000007", amount: 5000, payment_kind: "full" }),
    pay({
      id: "g-rev",
      phone: "9000000007",
      amount: -5000,
      payment_kind: "full",
      payment_source: "student_proof_reversal",
      reversal_of_payment_id: "g",
    }),
    pay({ id: "staff", phone: "9999999999", amount: 99999, payment_kind: "full" }),
    pay({ id: "demo", phone: "9000000008", amount: 1000, reference_no: "DEMO-1", gateway_ref: "DEMO-1" }),
    pay({ id: "dup", phone: "9000000009", amount: 7000, duplicate_of_payment_id: "other" }),
    pay({ id: "deleted", phone: "9000000010", amount: 3000, deleted_at: AT }),
    pay({ id: "yesterday", phone: "9000000011", amount: 4000, created_at: "2026-09-20T18:29:00.000Z" }),
    pay({ id: "midnight", phone: "9000000012", amount: 100, payment_kind: "seat", created_at: "2026-09-20T18:30:00.000Z" }),
  ];

  const m = computeCollections(rows, DAY, staff);

  test("net, gross, and refunds", () => {
    // 2000+10000+40000+5000+5000+100 = 62100 gross; refund 5000; net 57100
    assert.equal(m.grossCollection, 62100);
    assert.equal(m.refundAmount, 5000);
    assert.equal(m.netCollection, 57100);
    assert.equal(m.successfulPayments, 6);
    assert.equal(m.payingStudents, 6);
  });

  test("categories sum to gross", () => {
    assert.equal(collectionsReconcile(m), true);
    const seat = m.categories.find((c) => c.key === "seat")!;
    const inst = m.categories.find((c) => c.key === "installment")!;
    const adm = m.categories.find((c) => c.key === "admission")!;
    assert.equal(seat.amount, 2100);
    assert.equal(seat.students, 2);
    assert.equal(inst.amount, 10000);
    assert.equal(inst.students, 1);
    assert.equal(adm.amount, 50000);
    assert.equal(adm.students, 3);
  });

  test("one student paying twice counts as two payments and one student", () => {
    const twice = computeCollections(
      [
        pay({ id: "i1", phone: "9000000020", amount: 1000, payment_kind: "installment", installment_no: 1 }),
        pay({ id: "i2", phone: "9000000020", amount: 1000, payment_kind: "installment", installment_no: 2 }),
      ],
      DAY,
      new Set(),
    );
    assert.equal(twice.successfulPayments, 2);
    assert.equal(twice.payingStudents, 1);
    assert.equal(twice.netCollection, 2000);
  });
});

describe("people metrics", () => {
  test("new, unique logins, events, active, and returning reconcile", () => {
    const m = computePeople({
      newAccountKeys: ["p:9000000001"],
      loginEventKeys: [
        "p:9000000001",
        "p:9000000002",
        "p:9000000004",
        "p:9000000004",
        "p:9000000004",
        "p:9000000004",
        "p:9000000004",
      ],
      activityKeys: ["p:9000000003"],
    });
    assert.equal(m.newAccounts, 1);
    assert.equal(m.uniqueLoginUsers, 3);
    assert.equal(m.loginEvents, 7);
    assert.equal(m.activeUsers, 4);
    assert.equal(m.newUsersActive, 1);
    assert.equal(m.returningActiveUsers, 3);
    assert.equal(m.activeUsers, (m.newUsersActive || 0) + (m.returningActiveUsers || 0));
  });

  test("missing activity is null, not zero", () => {
    const m = computePeople({ newAccountKeys: ["p:1"], loginEventKeys: null, activityKeys: null });
    assert.equal(m.newAccounts, 1);
    assert.equal(m.uniqueLoginUsers, null);
    assert.equal(m.activeUsers, null);
    assert.equal(m.returningActiveUsers, null);
  });
});

describe("admissions", () => {
  test("counts active enrollments created that IST day, not staff or unpaid attempts", () => {
    const enrollments = [
      { id: "1", phone: "9000000001", course_title: "GS", amount_paid: 2000, status: "partial", created_at: AT },
      { id: "2", phone: "9000000002", course_title: "GS", amount_paid: 40000, status: "fully_paid", created_at: AT },
      { id: "3", phone: "9000000003", course_title: "Optional", amount_paid: 0, status: "pending", created_at: AT },
      { id: "4", phone: "9999999999", course_title: "GS", amount_paid: 100, status: "partial", created_at: AT },
      {
        id: "5",
        phone: "9000000004",
        course_title: "GS",
        amount_paid: 100,
        status: "partial",
        created_at: "2026-09-20T10:00:00.000Z",
      },
    ] as CourseEnrollment[];
    const m = computeAdmissions(enrollments, DAY, new Set(["9999999999"]));
    assert.equal(m.admissions, 2);
    assert.equal(m.students, 2);
    assert.equal(m.byCourse[0]?.title, "GS");
    assert.equal(m.byCourse[0]?.admissions, 2);
  });
});

describe("monthly schedule (IST)", () => {
  test("1 Oct 00:05 IST reports September", () => {
    const slot = resolveMonthlyReportSlot(new Date("2026-09-30T18:35:00.000Z"));
    assert.equal(slot?.slotKey, "monthly:2026-09");
    assert.equal(slot?.label, "SEPTEMBER 2026");
    assert.equal(slot?.window.fromMs, new Date("2026-08-31T18:30:00.000Z").getTime());
    assert.equal(slot?.window.toMs, new Date("2026-09-30T18:30:00.000Z").getTime());
  });

  test("quiet hour on the 1st waits", () => {
    const slot = resolveMonthlyReportSlot(new Date("2026-09-30T18:35:00.000Z"), (hour) => hour < 6);
    assert.equal(slot, null);
  });

  test("1 Oct 07:05 IST still owes September", () => {
    const slot = resolveMonthlyReportSlot(new Date("2026-10-01T01:35:00.000Z"), (hour) => hour < 6);
    assert.equal(slot?.slotKey, "monthly:2026-09");
  });

  test("30 Sep and 2 Oct are not the monthly slot", () => {
    assert.equal(resolveMonthlyReportSlot(new Date("2026-09-30T17:30:00.000Z")), null);
    assert.equal(resolveMonthlyReportSlot(new Date("2026-10-01T18:35:00.000Z")), null);
  });

  test("1 Jan reports December of the previous year", () => {
    const slot = resolveMonthlyReportSlot(new Date("2025-12-31T19:00:00.000Z"));
    assert.equal(slot?.slotKey, "monthly:2025-12");
    assert.equal(slot?.label, "DECEMBER 2025");
  });
});

describe("telegram formatting", () => {
  test("daily block shows net collection and escapes course titles", () => {
    const money = computeCollections(
      [
        pay({ id: "a", phone: "9000000001", amount: 2000, payment_kind: "seat" }),
        pay({ id: "b", phone: "9000000002", amount: 10000, payment_kind: "installment", installment_no: 1 }),
      ],
      DAY,
      new Set(),
    );
    const lines = dailyBusinessLines({
      people: computePeople({
        newAccountKeys: ["p:9000000001"],
        loginEventKeys: ["p:9000000001"],
        activityKeys: [],
      }),
      today: money,
      todayAdmissions: { admissions: 1, students: 1, byCourse: [{ title: "GS <Foundation>", admissions: 1 }] },
      mtd: money,
      mtdAdmissions: { admissions: 1, students: 1, byCourse: [] },
    });
    const html = lines.join("\n");
    assert.match(html, /New accounts <b>1<\/b>/);
    assert.match(html, /Unique logins <b>1<\/b>/);
    assert.match(html, /Net <b>₹12,000<\/b>/);
    assert.match(html, /Seat bookings — <b>₹2,000<\/b>/);
    assert.match(html, /Installments — <b>₹10,000<\/b>/);
    assert.match(html, /GS &lt;Foundation&gt;/);
    assert.equal(html.includes("<Foundation>"), false);
  });

  test("monthly report states gross, refunds, and net", () => {
    const money = computeCollections(
      [
        pay({ id: "g", phone: "9000000007", amount: 5000 }),
        pay({
          id: "g-rev",
          phone: "9000000007",
          amount: -5000,
          payment_source: "student_proof_reversal",
          reversal_of_payment_id: "g",
        }),
      ],
      DAY,
      new Set(),
    );
    const html = monthlyBusinessHtml({
      label: "SEPTEMBER 2026",
      people: null,
      money,
      admissions: { admissions: 0, students: 0, byCourse: [] },
    });
    assert.match(html, /MONTHLY BUSINESS REPORT/);
    assert.match(html, /Net collection <b>₹0<\/b>/);
    assert.match(html, /Gross <b>₹5,000<\/b>/);
    assert.match(html, /Refunds <b>₹5,000<\/b>/);
  });
});
