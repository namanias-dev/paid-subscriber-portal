/**
 * Payment finalize allocation + demo-ledger idempotency (in-process only).
 *
 * DEMO TESTS ARE NOT PROOF of multi-connection Postgres safety.
 * Real DB concurrency is covered by
 * tests/payment-finalize/pg-rpc.integration.test.mts
 * (npm run test:payment-finalize-pg with PAYMENT_FINALIZE_PG_URL).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import type { CourseEnrollment, InstallmentItem, Payment, PaymentReceipt } from "../../lib/types";
import {
  allocatePaymentToSchedule,
  pickCanonicalReceipt,
} from "../../lib/paymentFinalize/allocateSchedule";
import {
  finalizeCoursePaymentDemo,
  resetDemoFinalizeLedger,
} from "../../lib/paymentFinalize/demoFinalize";
import { enrollmentFeeStateFromEnrollment } from "../../lib/enrollmentFeeState";

function line(partial: Partial<InstallmentItem> & Pick<InstallmentItem, "no" | "kind" | "label" | "amount">): InstallmentItem {
  return {
    due: partial.due ?? null,
    paid: partial.paid ?? false,
    status: partial.status ?? "pending",
    paid_at: partial.paid_at ?? null,
    reference_no: partial.reference_no ?? null,
    gateway_ref: partial.gateway_ref ?? null,
    payment_id: partial.payment_id ?? null,
    paid_amount: partial.paid_amount ?? null,
    carried_in: partial.carried_in ?? 0,
    carried_out: partial.carried_out ?? 0,
    ...partial,
  } as InstallmentItem;
}

function emiSchedule(): InstallmentItem[] {
  return [
    line({ no: 0, kind: "seat", label: "Book Your Seat", amount: 2000, due: null }),
    line({ no: 1, kind: "installment", label: "Installment 1 of 4", amount: 8250, due: "2026-08-10T06:30:00.000Z" }),
    line({ no: 2, kind: "installment", label: "Installment 2 of 4", amount: 8250, due: "2026-10-10T06:30:00.000Z" }),
    line({ no: 3, kind: "installment", label: "Installment 3 of 4", amount: 8250, due: "2026-12-10T06:30:00.000Z" }),
    line({ no: 4, kind: "installment", label: "Installment 4 of 4", amount: 8250, due: "2027-02-10T06:30:00.000Z" }),
  ];
}

function payment(partial: Partial<Payment> & Pick<Payment, "id" | "amount" | "payment_kind">): Payment {
  return {
    student_name: "Test",
    phone: "9999999999",
    item: "Course",
    item_type: "course",
    status: "PAID",
    reference_no: partial.reference_no || `REF-${partial.id}`,
    created_at: "2026-08-10T06:40:00.000Z",
    enrollment_id: "enr-1",
    ...partial,
  } as Payment;
}

describe("allocatePaymentToSchedule", () => {
  it("marks only the oldest installment and never exceeds payment amount", () => {
    const schedule = emiSchedule();
    schedule[0] = { ...schedule[0]!, paid: true, status: "paid", reference_no: "SEAT-1" };
    const r = allocatePaymentToSchedule(schedule, {
      amount: 8250,
      payment_kind: "installment",
      payment_id: "pay-1",
      reference_no: "NAMAN-COURSE-TEST-1",
    });
    assert.equal(r.allocatedAmount, 8250);
    assert.equal(r.schedule[1]!.paid, true);
    assert.equal(r.schedule[2]!.paid, false);
    assert.equal(r.paymentLabel, "Installment 1 of 4");
  });

  it("refuses an installment payment smaller than the line (non-proof)", () => {
    const schedule = emiSchedule();
    schedule[0] = { ...schedule[0]!, paid: true, status: "paid" };
    const r = allocatePaymentToSchedule(schedule, {
      amount: 8000,
      payment_kind: "installment",
      payment_id: "pay-small",
      reference_no: "REF-SMALL",
    });
    assert.equal(r.noop, true);
    assert.equal(r.allocatedAmount, 0);
    assert.equal(r.schedule[1]!.paid, false);
  });

  it("full payment waterfalls across multiple installments up to budget", () => {
    const schedule = emiSchedule();
    schedule[0] = { ...schedule[0]!, paid: true, status: "paid" };
    const r = allocatePaymentToSchedule(schedule, {
      amount: 16500,
      payment_kind: "full",
      payment_id: "pay-full",
      reference_no: "REF-FULL",
    });
    assert.equal(r.allocatedAmount, 16500);
    assert.equal(r.schedule[1]!.paid, true);
    assert.equal(r.schedule[2]!.paid, true);
    assert.equal(r.schedule[3]!.paid, false);
  });

  it("records student_proof partial without clearing the line", () => {
    const schedule = emiSchedule();
    schedule[0] = { ...schedule[0]!, paid: true, status: "paid" };
    const r = allocatePaymentToSchedule(schedule, {
      amount: 3000,
      payment_kind: "installment",
      payment_source: "student_proof",
      payment_id: "pay-partial",
      reference_no: "REF-PARTIAL",
    });
    assert.equal(r.allocatedAmount, 3000);
    assert.equal(r.schedule[1]!.paid, false);
    assert.equal(r.schedule[1]!.status, "partially_paid");
    assert.equal(r.schedule[1]!.paid_amount, 3000);
  });

  it("completes a partially_paid installment remainder without skipping it", () => {
    const schedule = emiSchedule();
    schedule[0] = { ...schedule[0]!, paid: true, status: "paid" };
    schedule[1] = {
      ...schedule[1]!,
      paid: false,
      status: "partially_paid",
      paid_amount: 3000,
      reference_no: "REF-PART",
    };
    const r = allocatePaymentToSchedule(schedule, {
      amount: 5250,
      payment_kind: "installment",
      payment_source: "student_proof",
      payment_id: "pay-rem",
      reference_no: "REF-REM",
    });
    assert.equal(r.noop, false);
    assert.equal(r.allocatedAmount, 5250);
    assert.equal(r.schedule[1]!.paid, true);
    assert.equal(r.schedule[2]!.paid, false);
    const fee = enrollmentFeeStateFromEnrollment({
      id: "e",
      total_fee: 35000,
      discount_amount: 10000,
      amount_paid: 0,
      schedule: r.schedule,
    });
    assert.equal(fee.netPaid, 10250);
  });

  it("partial seat then remainder completion conserves seat amount", () => {
    const schedule = emiSchedule();
    const p1 = allocatePaymentToSchedule(schedule, {
      amount: 800,
      payment_kind: "seat",
      payment_source: "student_proof",
      payment_id: "seat-p1",
      reference_no: "SEAT-P1",
    });
    assert.equal(p1.schedule[0]!.status, "partially_paid");
    assert.equal(p1.allocatedAmount, 800);
    const p2 = allocatePaymentToSchedule(p1.schedule, {
      amount: 1200,
      payment_kind: "seat",
      payment_source: "student_proof",
      payment_id: "seat-p2",
      reference_no: "SEAT-P2",
    });
    assert.equal(p2.allocatedAmount, 1200);
    assert.equal(p2.schedule[0]!.paid, true);
    assert.equal(enrollmentFeeStateFromEnrollment({
      id: "e", total_fee: 35000, discount_amount: 0, amount_paid: 0, schedule: p2.schedule,
    }).netPaid, 2000);
  });

  it("full-balance payment after partial installment includes the remainder", () => {
    const schedule = emiSchedule();
    schedule[0] = { ...schedule[0]!, paid: true, status: "paid" };
    schedule[1] = {
      ...schedule[1]!,
      paid: false,
      status: "partially_paid",
      paid_amount: 2000,
    };
    const r = allocatePaymentToSchedule(schedule, {
      amount: 20000,
      payment_kind: "full",
      payment_id: "pay-full-rem",
      reference_no: "REF-FULL-REM",
    });
    assert.equal(r.schedule[1]!.paid, true);
    assert.equal(r.allocatedAmount, 20000);
    assert.equal(
      enrollmentFeeStateFromEnrollment({
        id: "e",
        total_fee: 35000,
        discount_amount: 10000,
        amount_paid: 0,
        schedule: r.schedule,
      }).netPaid,
      24000,
    );
  });

  it("explains ₹1 EMI rounding: 33000/3 = 11000, last line can absorb remainder", () => {
    // 35000 - 2000 seat = 33000; 33000/3 = 11000 exact — Akash-style 8333 is a
    // different plan. Model 25000 remaining / 3 → 8333+8333+8334.
    const remaining = 25000;
    const n = 3;
    const base = Math.floor(remaining / n);
    const last = remaining - base * (n - 1);
    assert.equal(base, 8333);
    assert.equal(last, 8334);
    assert.equal(base + base + last, remaining);
    const schedule = [
      line({ no: 0, kind: "seat", label: "Seat", amount: 2000, paid: true, status: "paid" }),
      line({ no: 1, kind: "installment", label: "Installment 1 of 3", amount: base, due: "2026-09-01T00:00:00.000Z" }),
      line({ no: 2, kind: "installment", label: "Installment 2 of 3", amount: base, due: "2026-10-01T00:00:00.000Z" }),
      line({ no: 3, kind: "installment", label: "Installment 3 of 3", amount: last, due: "2026-11-01T00:00:00.000Z" }),
    ];
    const r1 = allocatePaymentToSchedule(schedule, {
      amount: base,
      payment_kind: "installment",
      payment_id: "p1",
      reference_no: "R1",
    });
    assert.equal(r1.allocatedAmount, 8333);
    const r2 = allocatePaymentToSchedule(r1.schedule, {
      amount: base,
      payment_kind: "installment",
      payment_id: "p2",
      reference_no: "R2",
    });
    assert.equal(r2.allocatedAmount, 8333);
    const r3 = allocatePaymentToSchedule(r2.schedule, {
      amount: last,
      payment_kind: "installment",
      payment_id: "p3",
      reference_no: "R3",
    });
    assert.equal(r3.allocatedAmount, 8334);
    const fee = enrollmentFeeStateFromEnrollment({
      id: "e",
      total_fee: 27000,
      discount_amount: 0,
      amount_paid: 0,
      schedule: r3.schedule,
    });
    assert.equal(fee.netPaid, 27000);
    assert.equal(fee.outstanding, 0);
  });
});

describe("pickCanonicalReceipt", () => {
  it("prefers evidence over a phantom payment.receipt_no pointer", () => {
    const rows = [
      { id: "a", receipt_no: "NSA-1", payment_label: "Installment 1 of 4", issued_at: "2026-08-10T06:40:29.204Z" },
      { id: "b", receipt_no: "NSA-2", payment_label: "Installment 1 of 4", issued_at: "2026-08-10T06:40:29.237Z" },
      { id: "c", receipt_no: "NSA-3", payment_label: "Installment 2 of 4", issued_at: "2026-08-10T06:40:31.340Z" },
    ];
    // Phantom pointer NSA-3 must not win when installment_no=1 evidence exists.
    assert.equal(
      pickCanonicalReceipt(rows, {
        paymentReceiptNo: "NSA-3",
        paymentKind: "installment",
        installmentNo: 1,
      })?.id,
      "a",
    );
    assert.equal(pickCanonicalReceipt(rows, { paymentKind: "installment", installmentNo: 1 })?.id, "a");
  });

  it("returns null when requireEvidence and labels conflict without a unique match", () => {
    const rows = [
      { id: "a", receipt_no: "NSA-1", payment_label: "Installment 2 of 4", issued_at: "2026-08-10T06:40:29.204Z" },
      { id: "b", receipt_no: "NSA-2", payment_label: "Payment", issued_at: "2026-08-10T06:40:31.340Z" },
    ];
    assert.equal(
      pickCanonicalReceipt(rows, {
        paymentReceiptNo: "NSA-2",
        paymentKind: "installment",
        installmentNo: 1,
        requireEvidence: true,
      }),
      null,
    );
  });

  it("ignores superseded rows when an active one exists", () => {
    const rows = [
      { id: "old", receipt_no: "NSA-1", payment_label: "Installment 2 of 4", issued_at: "2026-08-10T06:40:31.340Z", superseded_at: "2026-10-12T00:00:00Z" },
      { id: "keep", receipt_no: "NSA-0", payment_label: "Installment 1 of 4", issued_at: "2026-08-10T06:40:29.204Z" },
    ];
    assert.equal(pickCanonicalReceipt(rows, { paymentKind: "installment", installmentNo: 1 })?.id, "keep");
  });
});

describe("demo finalize idempotency / concurrency", () => {
  beforeEach(() => resetDemoFinalizeLedger());

  function enroll(schedule: InstallmentItem[]): CourseEnrollment {
    return {
      id: "enr-1",
      phone: "9999999999",
      student_name: "Test",
      email: null,
      course_id: "c1",
      course_slug: "safalta",
      course_title: "Safalta",
      batch_label: "Evening",
      plan_type: "emi",
      total_fee: 35000,
      amount_paid: 2000,
      installment_count: 4,
      status: "seat_booked",
      schedule,
      created_at: "2026-08-03T10:00:00.000Z",
      updated_at: "2026-08-03T10:00:00.000Z",
      discount_amount: 10000,
    } as CourseEnrollment;
  }

  it("concurrent finalizers of the same payment allocate once", async () => {
    const schedule = emiSchedule();
    schedule[0] = {
      ...schedule[0]!,
      paid: true,
      status: "paid",
      reference_no: "SEAT",
      paid_at: "2026-08-03T09:42:26.084Z",
    };
    const enr = enroll(schedule);
    const pay = payment({ id: "pay-race", amount: 8250, payment_kind: "installment", reference_no: "REF-RACE" });
    const receipts: PaymentReceipt[] = [];
    const persist = async (e: CourseEnrollment, r: PaymentReceipt) => {
      enr.schedule = e.schedule;
      enr.amount_paid = e.amount_paid;
      enr.status = e.status;
      receipts.push(r);
    };
    const opts = {
      payment: pay,
      enrollment: enr,
      getReceiptsForPayment: () => receipts.slice(),
      nextReceiptNo: async () => `NSA-${receipts.length + 1}`,
      persist,
    };
    const [a, b, c] = await Promise.all([
      finalizeCoursePaymentDemo(opts),
      finalizeCoursePaymentDemo(opts),
      finalizeCoursePaymentDemo(opts),
    ]);
    const oks = [a, b, c].filter((x) => x.ok);
    assert.equal(oks.length, 3);
    assert.equal(receipts.length, 1, "only one receipt persisted");
    assert.equal(enr.schedule[1]!.paid, true);
    assert.equal(enr.schedule[2]!.paid, false, "second installment must stay open");
    const fee = enrollmentFeeStateFromEnrollment(enr);
    assert.equal(fee.netPaid, 10250);
    assert.equal(fee.paidCount, 1);
  });

  it("retry after success returns already_finalized without touching Inst 2", async () => {
    const schedule = emiSchedule();
    schedule[0] = { ...schedule[0]!, paid: true, status: "paid", reference_no: "SEAT" };
    const enr = enroll(schedule);
    const pay = payment({ id: "pay-retry", amount: 8250, payment_kind: "installment", reference_no: "REF-RETRY" });
    const receipts: PaymentReceipt[] = [];
    const opts = {
      payment: pay,
      enrollment: enr,
      getReceiptsForPayment: () => receipts.slice(),
      nextReceiptNo: async () => `NSA-R-${receipts.length + 1}`,
      persist: async (e: CourseEnrollment, r: PaymentReceipt) => {
        Object.assign(enr, e);
        receipts.push(r);
      },
    };
    const first = await finalizeCoursePaymentDemo(opts);
    assert.equal(first.outcome, "created");
    const second = await finalizeCoursePaymentDemo(opts);
    assert.equal(second.outcome, "already_finalized");
    assert.equal(receipts.length, 1);
    assert.equal(enr.schedule[2]!.paid, false);
  });

  it("existing duplicate receipts reconcile without re-allocation", async () => {
    const schedule = emiSchedule();
    schedule[0] = { ...schedule[0]!, paid: true, status: "paid", reference_no: "SEAT" };
    schedule[1] = {
      ...schedule[1]!,
      paid: true,
      status: "paid",
      reference_no: "REF-DUP",
      paid_at: "2026-08-10T06:40:29.204Z",
    };
    // Historical bug state: Inst 2 also stamped — reconcile must NOT clear more,
    // and must not invent another receipt allocation pass.
    schedule[2] = {
      ...schedule[2]!,
      paid: true,
      status: "paid",
      reference_no: "REF-DUP",
      paid_at: "2026-08-10T06:40:31.340Z",
    };
    const enr = enroll(schedule);
    enr.amount_paid = 18500;
    const prior: PaymentReceipt[] = [
      {
        id: "r1",
        receipt_no: "NSA-1165",
        enrollment_id: enr.id,
        payment_id: "pay-dup",
        reference_no: "REF-DUP",
        phone: enr.phone,
        student_name: enr.student_name,
        email: null,
        course_title: enr.course_title,
        batch_label: enr.batch_label,
        payment_kind: "installment",
        payment_label: "Installment 1 of 4",
        amount: 8250,
        gateway_ref: "G1",
        total_fee: 35000,
        paid_to_date: 10250,
        remaining: 24750,
        installments_summary: "x",
        status: "Partially Paid",
        issued_at: "2026-08-10T06:40:29.204Z",
      },
      {
        id: "r2",
        receipt_no: "NSA-1166",
        enrollment_id: enr.id,
        payment_id: "pay-dup",
        reference_no: "REF-DUP",
        phone: enr.phone,
        student_name: enr.student_name,
        email: null,
        course_title: enr.course_title,
        batch_label: enr.batch_label,
        payment_kind: "installment",
        payment_label: "Installment 1 of 4",
        amount: 8250,
        gateway_ref: "G1",
        total_fee: 35000,
        paid_to_date: 10250,
        remaining: 24750,
        installments_summary: "x",
        status: "Partially Paid",
        issued_at: "2026-08-10T06:40:29.237Z",
      },
      {
        id: "r3",
        receipt_no: "NSA-1167",
        enrollment_id: enr.id,
        payment_id: "pay-dup",
        reference_no: "REF-DUP",
        phone: enr.phone,
        student_name: enr.student_name,
        email: null,
        course_title: enr.course_title,
        batch_label: enr.batch_label,
        payment_kind: "installment",
        payment_label: "Installment 2 of 4",
        amount: 8250,
        gateway_ref: "G1",
        total_fee: 35000,
        paid_to_date: 18500,
        remaining: 16500,
        installments_summary: "x",
        status: "Partially Paid",
        issued_at: "2026-08-10T06:40:31.340Z",
      },
    ];
    const pay = payment({
      id: "pay-dup",
      amount: 8250,
      payment_kind: "installment",
      reference_no: "REF-DUP",
      receipt_no: "NSA-1167",
      installment_no: 1,
    });
    let persisted = 0;
    const result = await finalizeCoursePaymentDemo({
      payment: pay,
      enrollment: enr,
      getReceiptsForPayment: () => prior,
      nextReceiptNo: async () => "NSA-SHOULD-NOT",
      persist: async () => {
        persisted++;
      },
    });
    assert.equal(result.outcome, "reconciled_existing");
    assert.equal(persisted, 0);
    // Evidence (installment_no=1) wins over phantom payment.receipt_no NSA-1167.
    assert.equal(result.receipt?.receipt_no, "NSA-1165");
    // Schedule left untouched for repair tooling — finalize must not "fix" by allocating again.
    assert.equal(enr.schedule[2]!.paid, true);
  });

  it("two distinct payments on one enrollment serialize and both apply", async () => {
    const schedule = emiSchedule();
    const enr = enroll(schedule);
    enr.amount_paid = 0;
    enr.status = "pending";
    const holder = { current: enr };
    const receipts: PaymentReceipt[] = [];
    const persist = async (e: CourseEnrollment, r: PaymentReceipt) => {
      holder.current = { ...e, schedule: e.schedule.map((s) => ({ ...s })) };
      Object.assign(enr, holder.current);
      receipts.push(r);
    };
    const seat = payment({ id: "pay-seat", amount: 2000, payment_kind: "seat", reference_no: "REF-SEAT" });
    const inst = payment({ id: "pay-inst", amount: 8250, payment_kind: "installment", reference_no: "REF-INST" });
    const [s, i] = await Promise.all([
      finalizeCoursePaymentDemo({
        payment: seat,
        enrollment: enr,
        enrollmentRef: holder,
        getReceiptsForPayment: (id) => receipts.filter((r) => r.payment_id === id),
        nextReceiptNo: async () => `NSA-S-${receipts.length + 1}`,
        persist,
      }),
      finalizeCoursePaymentDemo({
        payment: inst,
        enrollment: enr,
        enrollmentRef: holder,
        getReceiptsForPayment: (id) => receipts.filter((r) => r.payment_id === id),
        nextReceiptNo: async () => `NSA-I-${receipts.length + 1}`,
        persist,
      }),
    ]);
    assert.equal(s.ok, true);
    assert.equal(i.ok, true);
    assert.equal(holder.current.schedule[0]!.paid, true);
    assert.equal(holder.current.schedule[1]!.paid, true);
    assert.equal(holder.current.schedule[2]!.paid, false);
    assert.equal(enrollmentFeeStateFromEnrollment(holder.current).netPaid, 10250);
    assert.equal(receipts.length, 2);
  });

  it("persist failure mid-flight then retry allocates exactly once", async () => {
    const schedule = emiSchedule();
    schedule[0] = { ...schedule[0]!, paid: true, status: "paid", reference_no: "SEAT" };
    const enr = enroll(schedule);
    const pay = payment({ id: "pay-fail", amount: 8250, payment_kind: "installment", reference_no: "REF-FAIL" });
    const receipts: PaymentReceipt[] = [];
    let attempts = 0;
    const opts = {
      payment: pay,
      enrollment: enr,
      getReceiptsForPayment: () => receipts.slice(),
      nextReceiptNo: async () => `NSA-F-${receipts.length + 1}`,
      persist: async (e: CourseEnrollment, r: PaymentReceipt) => {
        attempts++;
        if (attempts === 1) throw new Error("simulated_receipt_insert_failure");
        Object.assign(enr, e);
        receipts.push(r);
      },
    };
    await assert.rejects(() => finalizeCoursePaymentDemo(opts), /simulated_receipt_insert_failure/);
    assert.equal(receipts.length, 0);
    assert.equal(enr.schedule[1]!.paid, false);
    const retry = await finalizeCoursePaymentDemo(opts);
    assert.equal(retry.outcome, "created");
    assert.equal(receipts.length, 1);
    assert.equal(enr.schedule[1]!.paid, true);
    assert.equal(enr.schedule[2]!.paid, false);
    const again = await finalizeCoursePaymentDemo(opts);
    assert.equal(again.outcome, "already_finalized");
    assert.equal(receipts.length, 1);
  });

  it("offline/cash payment with OFF- reference finalizes once without touching later EMIs", async () => {
    const schedule = [
      line({ no: 1, kind: "installment", label: "Installment 1 of 8", amount: 4000, paid: true, status: "paid", reference_no: "LEGACY" }),
      line({ no: 2, kind: "installment", label: "Installment 2 of 8", amount: 4000, due: "2026-08-16T06:30:00.000Z" }),
      line({ no: 3, kind: "installment", label: "Installment 3 of 8", amount: 4000, due: "2026-09-16T06:30:00.000Z" }),
    ];
    const enr = enroll(schedule);
    enr.total_fee = 70000;
    enr.amount_paid = 4000;
    const pay = payment({
      id: "pay-off",
      amount: 4000,
      payment_kind: "installment",
      reference_no: "OFF-MSMZL7X3-Y2JN",
      payment_mode: "Cash",
      gateway_ref: "Cash",
    });
    const receipts: PaymentReceipt[] = [];
    const opts = {
      payment: pay,
      enrollment: enr,
      getReceiptsForPayment: () => receipts.slice(),
      nextReceiptNo: async () => "NSA-OFF-1",
      persist: async (e: CourseEnrollment, r: PaymentReceipt) => {
        Object.assign(enr, e);
        receipts.push(r);
      },
    };
    const first = await finalizeCoursePaymentDemo(opts);
    assert.equal(first.ok, true);
    assert.equal(enr.schedule[1]!.paid, true);
    assert.equal(enr.schedule[1]!.reference_no, "OFF-MSMZL7X3-Y2JN");
    assert.equal(enr.schedule[2]!.paid, false);
    const second = await finalizeCoursePaymentDemo(opts);
    assert.equal(second.outcome, "already_finalized");
    assert.equal(receipts.length, 1);
    assert.equal(enr.schedule[2]!.paid, false);
  });

  it("transferred seat credit: recompute-style apply keeps seat once via reference", () => {
    // Seat payment still belongs to morning enrollment_id; evening schedule carries the ref.
    const evening = emiSchedule();
    evening[0] = {
      ...evening[0]!,
      paid: false,
      status: "pending",
      reference_no: null,
    };
    const seatPay = payment({
      id: "pay-seat-morning",
      amount: 2000,
      payment_kind: "seat",
      reference_no: "NAMAN-COURSE-MSACLFJ4-LYFH",
      enrollment_id: "morning-enr",
    });
    const instPay = payment({
      id: "pay-inst-evening",
      amount: 8250,
      payment_kind: "installment",
      reference_no: "NAMAN-COURSE-MSMV2WHW-3IX7",
      enrollment_id: "evening-enr",
    });
    // Simulate recompute: reset then apply transferred seat + evening installment once each.
    let schedule = evening.map((s) => ({ ...s, paid: false, reference_no: null, payment_id: null, status: "pending" as const }));
    for (const p of [seatPay, instPay]) {
      const r = allocatePaymentToSchedule(schedule, {
        amount: p.amount,
        payment_kind: p.payment_kind,
        payment_id: p.id,
        reference_no: p.reference_no || "",
      });
      schedule = r.schedule;
    }
    assert.equal(schedule[0]!.paid, true);
    assert.equal(schedule[0]!.reference_no, "NAMAN-COURSE-MSACLFJ4-LYFH");
    assert.equal(schedule[1]!.paid, true);
    assert.equal(schedule[2]!.paid, false);
    assert.equal(seatPay.enrollment_id, "morning-enr", "original payment enrollment_id preserved");
    const fee = enrollmentFeeStateFromEnrollment({
      id: "evening-enr",
      total_fee: 35000,
      discount_amount: 10000,
      amount_paid: 0,
      schedule,
    });
    assert.equal(fee.netPaid, 10250);
    assert.equal(fee.outstanding, 24750);
  });
});
