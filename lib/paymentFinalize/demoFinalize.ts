/**
 * In-process finalize ledger for unit tests / demoMode.
 * Not multi-instance safe — production uses finalize_course_payment() RPC.
 */
import type { CourseEnrollment, Payment, PaymentReceipt } from "../types";
import { allocatePaymentToSchedule, pickCanonicalReceipt } from "./allocateSchedule";
import { enrollmentFeeStateFromEnrollment } from "../enrollmentFeeState";
import { enrollmentStatusFromSchedule } from "../installments";
import type { FinalizeCoursePaymentResult, FinalizeOutcome } from "./types";

type DemoLedgerRow = {
  payment_id: string;
  receipt: PaymentReceipt;
  enrollment: CourseEnrollment;
  allocatedAmount: number;
};

const demoLedger = new Map<string, DemoLedgerRow>();
const demoLocks = new Map<string, Promise<void>>();

async function withDemoLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  while (demoLocks.has(key)) {
    await demoLocks.get(key);
  }
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  demoLocks.set(key, gate);
  try {
    return await fn();
  } finally {
    demoLocks.delete(key);
    release();
  }
}

export async function finalizeCoursePaymentDemo(opts: {
  payment: Payment;
  enrollment: CourseEnrollment;
  getReceiptsForPayment: (paymentId: string, referenceNo: string) => PaymentReceipt[];
  nextReceiptNo: () => Promise<string>;
  persist: (enrollment: CourseEnrollment, receipt: PaymentReceipt) => Promise<void>;
  /** Optional mutable enrollment holder so concurrent distinct payments see each other's writes. */
  enrollmentRef?: { current: CourseEnrollment };
}): Promise<FinalizeCoursePaymentResult> {
  const { payment } = opts;
  const ref = payment.reference_no || "";
  const enrollmentId = opts.enrollmentRef?.current.id || opts.enrollment.id;
  // Mirror Postgres: enrollment advisory lock, then payment-scoped work.
  return withDemoLock(`enr:${enrollmentId}`, async () => {
    const enrollment = opts.enrollmentRef?.current || opts.enrollment;
    const existing = demoLedger.get(payment.id);
    if (existing) {
      return {
        ok: true,
        outcome: "already_finalized" as FinalizeOutcome,
        enrollment: existing.enrollment,
        receipt: existing.receipt,
        allocatedAmount: existing.allocatedAmount,
      };
    }
    const prior = opts.getReceiptsForPayment(payment.id, ref);
    if (prior.length || payment.receipt_no) {
      const canonical = pickCanonicalReceipt(prior, {
        paymentReceiptNo: payment.receipt_no,
        paymentKind: payment.payment_kind,
        installmentNo: payment.installment_no,
      });
      if (canonical) {
        demoLedger.set(payment.id, {
          payment_id: payment.id,
          receipt: canonical,
          enrollment,
          allocatedAmount: canonical.amount,
        });
        return {
          ok: true,
          outcome: "reconciled_existing",
          enrollment,
          receipt: canonical,
          allocatedAmount: canonical.amount,
        };
      }
    }
    if (payment.status !== "PAID" && payment.status !== "captured") {
      return { ok: false, outcome: "not_paid", enrollment: null, receipt: null, error: "payment_not_paid" };
    }
    const alloc = allocatePaymentToSchedule(enrollment.schedule || [], {
      amount: payment.amount,
      payment_kind: payment.payment_kind,
      installment_no: payment.installment_no,
      payment_source: payment.payment_source,
      payment_id: payment.id,
      reference_no: ref,
      gateway_ref: payment.gateway_ref || payment.razorpay_payment_id || null,
      paid_at: payment.transaction_date || payment.created_at || new Date().toISOString(),
    });
    if (alloc.noop || alloc.allocatedAmount <= 0) {
      return { ok: false, outcome: "noop", enrollment, receipt: null, error: "nothing_allocated" };
    }
    const fee = enrollmentFeeStateFromEnrollment({ ...enrollment, schedule: alloc.schedule });
    const status = enrollmentStatusFromSchedule({
      total_fee: enrollment.total_fee,
      schedule: alloc.schedule,
      plan_type: enrollment.plan_type,
    });
    const updated: CourseEnrollment = {
      ...enrollment,
      schedule: alloc.schedule,
      amount_paid: fee.netPaid,
      status,
    };
    const receipt: PaymentReceipt = {
      id: `demo-${payment.id}`,
      receipt_no: await opts.nextReceiptNo(),
      enrollment_id: enrollment.id,
      payment_id: payment.id,
      reference_no: ref,
      phone: enrollment.phone,
      student_name: enrollment.student_name,
      email: enrollment.email,
      course_title: enrollment.course_title,
      batch_label: enrollment.batch_label,
      payment_kind: (payment.payment_kind || "full") as PaymentReceipt["payment_kind"],
      payment_label: alloc.paymentLabel,
      amount: payment.amount,
      gateway_ref: payment.gateway_ref || null,
      total_fee: enrollment.total_fee,
      paid_to_date: fee.netPaid,
      remaining: fee.outstanding,
      installments_summary: alloc.paymentLabel,
      status: fee.isFullyPaid ? "Fully Paid" : status === "seat_booked" ? "Seat Booked" : "Partially Paid",
      method: payment.payment_mode || payment.mode || null,
      issued_at: new Date().toISOString(),
    };
    await opts.persist(updated, receipt);
    demoLedger.set(payment.id, {
      payment_id: payment.id,
      receipt,
      enrollment: updated,
      allocatedAmount: alloc.allocatedAmount,
    });
    return {
      ok: true,
      outcome: "created",
      enrollment: updated,
      receipt,
      allocatedAmount: alloc.allocatedAmount,
    };
  });
}

export function resetDemoFinalizeLedger(): void {
  demoLedger.clear();
}
