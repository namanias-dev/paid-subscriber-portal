/**
 * Approve installment proof AND record a real payment via recordOfflineCoursePayment.
 * Never inserts into payments directly. Flag-gated; grant-only remains separate.
 */
import { getSupabaseAdmin } from "./supabase";
import {
  getCourseEnrollmentById,
  getPaymentById,
  recordOfflineCoursePayment,
  createPayment,
  bumpBuyerSessionVersion,
  getReceiptByReference,
  updateCourseEnrollment,
  deleteAccessOverride,
} from "./dataProvider";
import { deriveEnrollment, enrollmentStatusFromSchedule, isLineOutstanding } from "./installments";
import { findOldestOutstandingIndex } from "./installmentAllocation";
import { runPaidTerminalSideEffects } from "./paymentOutcome/paidSideEffects";
import { appendStudentAccessEvent } from "./studentAccessEvents";
import { istInputToISO } from "./dates";
import { getProofById, supersedeProofsOnPaid, type InstallmentProofRow } from "./installmentPaymentProofs";
import type { Payment } from "./types";

function proofRef(proofId: string): string {
  const compact = proofId.replace(/-/g, "").slice(0, 18).toUpperCase();
  return `OFF-PROOF-${compact}`;
}

export async function proofRecordsPaymentEnabled(): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db
    .from("app_feature_flags")
    .select("enabled,kill_switch")
    .eq("key", "proof_records_payment")
    .maybeSingle();
  if (!data) return false;
  if (data.kill_switch) return false;
  return !!data.enabled;
}

async function paymentByProofId(proofId: string): Promise<Payment | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("payments").select("*").eq("proof_id", proofId).maybeSingle();
  return (data as Payment) || null;
}

async function writeAllocationAudit(input: {
  enrollmentId: string;
  studentName: string;
  phone: string;
  amountPaidBefore: number;
  amountPaidAfter: number;
  scheduleBefore: unknown;
  scheduleAfter: unknown;
  appliedBy: string;
  note: string;
}): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    await db.from("installment_allocation_audit").insert({
      enrollment_id: input.enrollmentId,
      student_name: input.studentName,
      phone: input.phone,
      amount_paid_before: input.amountPaidBefore,
      amount_paid_after: input.amountPaidAfter,
      paid_sum_before: input.amountPaidBefore,
      paid_sum_after: input.amountPaidAfter,
      schedule_before: input.scheduleBefore,
      schedule_after: input.scheduleAfter,
      lock_before: null,
      lock_after: null,
      applied_by: input.appliedBy,
      note: input.note,
    });
  } catch {
    /* audit best-effort */
  }
}

export type ApproveAndRecordResult =
  | {
      ok: true;
      proof: InstallmentProofRow;
      payment: Payment;
      alreadyRecorded?: boolean;
      alreadyPaidSuperseded?: boolean;
    }
  | { ok: false; error: string; code?: string };

/**
 * Primary admin action: record instalment via recordOfflineCoursePayment, then
 * runPaidTerminalSideEffects (supersede proofs, session bump, notify).
 */
export async function approveAndRecordInstallmentProof(input: {
  proofId: string;
  actor: { id: string | null; name: string };
  amount: number;
  paymentDate?: string | null;
  referenceUtr?: string | null;
  seenProofConfirmed: boolean;
}): Promise<ApproveAndRecordResult> {
  if (!input.seenProofConfirmed) {
    return { ok: false, error: "Confirm you have seen proof of this payment.", code: "checkbox" };
  }
  if (!(await proofRecordsPaymentEnabled())) {
    return { ok: false, error: "Approve & record is disabled. Use Grant access only.", code: "flag_off" };
  }

  const proof = await getProofById(input.proofId);
  if (!proof) return { ok: false, error: "Proof not found." };
  if (proof.status === "approved_recorded" || proof.status === "approved") {
    const existing = await paymentByProofId(proof.id);
    if (existing) return { ok: true, proof, payment: existing, alreadyRecorded: true };
  }
  if (proof.status !== "pending") {
    return { ok: false, error: `Proof is ${proof.status}, not pending.` };
  }

  const existing = await paymentByProofId(proof.id);
  if (existing && !existing.reversed_at) {
    return { ok: true, proof, payment: existing, alreadyRecorded: true };
  }

  const e = await getCourseEnrollmentById(proof.course_enrollment_id);
  if (!e) return { ok: false, error: "Enrollment not found." };

  const derived = deriveEnrollment(e);
  if (derived.remaining <= 0 || derived.isFullyPaid) {
    return { ok: false, error: "Student is already fully paid — nothing to record.", code: "fully_paid" };
  }

  const schedule = e.schedule || [];
  const target =
    schedule.find((s) => s.kind === "installment" && s.no === proof.installment_no) || null;
  const oldestIdx = findOldestOutstandingIndex(schedule, "installment");
  if (target?.paid || oldestIdx < 0) {
    await supersedeProofsOnPaid({
      phone: e.phone,
      enrollmentId: e.id,
      installmentNo: proof.installment_no,
    });
    const db = getSupabaseAdmin();
    if (db) {
      await db
        .from("installment_payment_proofs")
        .update({
          status: "superseded",
          review_reason: "already paid — nothing recorded",
          reviewed_by: input.actor.name || input.actor.id || "admin",
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", proof.id)
        .eq("status", "pending");
    }
    await appendStudentAccessEvent({
      studentId: proof.student_id,
      phone: e.phone,
      courseId: e.course_id,
      courseEnrollmentId: e.id,
      eventType: "proof_superseded",
      actor: input.actor.name || "admin",
      channel: "installment_proof",
      installmentNo: proof.installment_no,
      reason: "already paid — nothing recorded",
      meta: { proofId: proof.id },
    });
    const refreshed = await getProofById(proof.id);
    return {
      ok: true,
      proof: refreshed || { ...proof, status: "superseded" },
      payment: existing || ({} as Payment),
      alreadyPaidSuperseded: true,
    };
  }

  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Amount must be greater than zero." };
  }

  const dateISO = input.paymentDate
    ? input.paymentDate.includes("T")
      ? input.paymentDate
      : istInputToISO(`${input.paymentDate}T12:00`)
    : new Date().toISOString();

  const noteParts = [
    "Student proof",
    input.referenceUtr?.trim() ? `UTR ${input.referenceUtr.trim()}` : null,
    `proof:${proof.id}`,
  ].filter(Boolean);

  const beforePaid = e.amount_paid || 0;
  const beforeSchedule = e.schedule;

  let recorded: Awaited<ReturnType<typeof recordOfflineCoursePayment>>;
  try {
    recorded = await recordOfflineCoursePayment({
      enrollmentId: e.id,
      kind: "installment",
      installmentNo: proof.installment_no,
      method: "Student proof",
      dateISO,
      note: noteParts.join(" · "),
      amountOverride: amount,
      referenceNo: proofRef(proof.id),
      proofId: proof.id,
      paymentSource: "student_proof",
      recordedBy: input.actor.name || input.actor.id || "admin",
      financeVerified: false,
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Recording failed.", code: "write_failed" };
  }

  if (!recorded.ok) {
    if (/proof_id|duplicate|unique/i.test(recorded.error)) {
      const raced = await paymentByProofId(proof.id);
      if (raced) return { ok: true, proof, payment: raced, alreadyRecorded: true };
    }
    return { ok: false, error: recorded.error };
  }

  const payment = recorded.payment;
  await runPaidTerminalSideEffects(payment, { source: "offline", bumpSession: true });

  await writeAllocationAudit({
    enrollmentId: e.id,
    studentName: e.student_name,
    phone: e.phone,
    amountPaidBefore: beforePaid,
    amountPaidAfter: recorded.enrollment.amount_paid,
    scheduleBefore: beforeSchedule,
    scheduleAfter: recorded.enrollment.schedule,
    appliedBy: input.actor.name || "admin",
    note: `student_proof:${proof.id}`,
  });

  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Database unavailable." };

  const { data, error } = await db
    .from("installment_payment_proofs")
    .update({
      status: "approved_recorded",
      reviewed_by: input.actor.name || input.actor.id || "admin",
      reviewed_at: new Date().toISOString(),
      review_reason: `Recorded ₹${payment.amount} via offline payment ${payment.reference_no}`,
      recorded_payment_id: payment.id,
      recorded_amount: payment.amount,
      expected_amount: target?.amount ?? proof.claimed_amount,
      expected_installment_no: proof.installment_no,
      updated_at: new Date().toISOString(),
    })
    .eq("id", proof.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message || "Payment recorded but proof status update failed — check finance queue.",
      code: "proof_status",
    };
  }

  const mapped: InstallmentProofRow = {
    ...proof,
    status: "approved_recorded",
    reviewed_by: String(data.reviewed_by || ""),
    reviewed_at: String(data.reviewed_at || ""),
    review_reason: String(data.review_reason || ""),
  };

  await appendStudentAccessEvent({
    studentId: proof.student_id,
    phone: e.phone,
    courseId: e.course_id,
    courseEnrollmentId: e.id,
    eventType: "proof_approved_recorded",
    actor: input.actor.name || "admin",
    channel: "installment_proof",
    installmentNo: proof.installment_no,
    reason: mapped.review_reason || undefined,
    meta: { proofId: proof.id, paymentId: payment.id, amount: payment.amount },
  });
  await appendStudentAccessEvent({
    studentId: proof.student_id,
    phone: e.phone,
    courseId: e.course_id,
    courseEnrollmentId: e.id,
    eventType: "payment_recorded",
    actor: input.actor.name || "admin",
    channel: "installment_proof",
    installmentNo: proof.installment_no,
    reason: `₹${payment.amount} student_proof`,
    meta: { proofId: proof.id, paymentId: payment.id, reference: payment.reference_no },
  });
  await appendStudentAccessEvent({
    studentId: proof.student_id,
    phone: e.phone,
    courseId: e.course_id,
    courseEnrollmentId: e.id,
    eventType: "access_restored",
    actor: input.actor.name || "admin",
    channel: "installment_proof",
    installmentNo: proof.installment_no,
    reason: "Payment recorded from proof",
    meta: { proofId: proof.id, paymentId: payment.id },
  });

  try {
    await db
      .from("access_call_tasks")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("course_enrollment_id", e.id)
      .eq("status", "open");
  } catch {
    /* optional */
  }

  return { ok: true, proof: mapped, payment };
}

/** Compensating reversal — never downgrades the original PAID row. */
export async function reverseProofRecordedPayment(input: {
  paymentId: string;
  actor: { id: string | null; name: string };
  reason: string;
}): Promise<{ ok: true; reversal: Payment } | { ok: false; error: string }> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Typed reason is required." };

  const payment = await getPaymentById(input.paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.payment_source !== "student_proof") {
    return { ok: false, error: "Only student_proof payments can be reversed here." };
  }
  if (payment.reversed_at) return { ok: false, error: "Already reversed." };

  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Database unavailable." };

  const enrollment = payment.enrollment_id
    ? await getCourseEnrollmentById(payment.enrollment_id)
    : null;

  const reversalRef = `OFF-REV-${(payment.reference_no || payment.id).replace(/[^A-Z0-9]/gi, "").slice(-16)}`;
  const { data: existingRev } = await db.from("payments").select("id").eq("reference_no", reversalRef).maybeSingle();
  if (existingRev) return { ok: false, error: "Reversal already exists." };

  const reversal = await createPayment({
    student_name: payment.student_name,
    phone: payment.phone,
    email: payment.email,
    item: `Reversal — ${payment.item}`,
    item_type: "course",
    item_slug: payment.item_slug,
    amount: -Math.abs(payment.amount),
    status: "PAID",
    gateway: "offline",
    reference_no: reversalRef,
    gateway_ref: `reversal of ${payment.reference_no || payment.id}`,
    payment_mode: "Student proof reversal",
    mode: "Student proof reversal",
    transaction_amount: -Math.abs(payment.amount),
    transaction_date: new Date().toISOString(),
    razorpay_payment_id: null,
    enrollment_id: payment.enrollment_id,
    payment_kind: payment.payment_kind,
    installment_no: payment.installment_no,
    payment_source: "student_proof_reversal",
    recorded_by: input.actor.name || input.actor.id || "admin",
    finance_verified: true,
    reversal_of_payment_id: payment.id,
  });

  await db
    .from("payments")
    .update({
      reversed_at: new Date().toISOString(),
      reversed_by: input.actor.name || input.actor.id || "admin",
      reversal_reason: reason.slice(0, 500),
    })
    .eq("id", payment.id);

  if (enrollment && payment.reference_no) {
    const schedule = (enrollment.schedule || []).map((s) => {
      if (s.reference_no !== payment.reference_no && s.payment_id !== payment.id) return s;
      return {
        ...s,
        paid: false,
        paid_at: null,
        reference_no: null,
        gateway_ref: null,
        payment_id: null,
        paid_amount: null,
        status: undefined,
      };
    });
    const d = deriveEnrollment({ total_fee: enrollment.total_fee, schedule });
    const status = enrollmentStatusFromSchedule({
      total_fee: enrollment.total_fee,
      schedule,
      plan_type: enrollment.plan_type,
    });
    await updateCourseEnrollment(enrollment.id, { schedule, amount_paid: d.paid, status });

    const receipt = await getReceiptByReference(payment.reference_no).catch(() => null);
    if (receipt) {
      try {
        await db.from("payment_receipts").delete().eq("id", receipt.id);
      } catch {
        /* best-effort */
      }
    }
  }

  if (payment.proof_id) {
    await db
      .from("installment_payment_proofs")
      .update({
        status: "rejected",
        review_reason: `Payment reversed: ${reason}`.slice(0, 500),
        reviewed_by: input.actor.name || input.actor.id || "admin",
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.proof_id);
  }

  // Revoke provisional proof grants so outstanding + grace recompute to blocked/expiring.
  // Otherwise reverse leaves lectureAccess live.allowed=true and State B never fires.
  if (enrollment) {
    const { data: ovr } = await db
      .from("course_access_overrides")
      .select("id,note,mode")
      .eq("phone", payment.phone)
      .eq("course_id", enrollment.course_id)
      .maybeSingle();
    const note = String(ovr?.note || "");
    if (
      ovr?.mode === "grant" &&
      (/payment proof approved/i.test(note) || /pending finance reconciliation/i.test(note))
    ) {
      await deleteAccessOverride(payment.phone, enrollment.course_id);
    }
  }

  await bumpBuyerSessionVersion(payment.phone).catch(() => null);

  await appendStudentAccessEvent({
    studentId: null,
    phone: payment.phone,
    courseId: enrollment?.course_id || null,
    courseEnrollmentId: payment.enrollment_id || null,
    eventType: "proof_payment_reversed",
    actor: input.actor.name || "admin",
    channel: "installment_proof",
    installmentNo: payment.installment_no ?? null,
    reason,
    meta: { paymentId: payment.id, reversalId: reversal.id, amount: payment.amount },
  });

  return { ok: true, reversal };
}

export async function markProofPaymentFinanceVerified(input: {
  paymentId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Database unavailable." };
  const { error } = await db
    .from("payments")
    .update({ finance_verified: true })
    .eq("id", input.paymentId)
    .eq("payment_source", "student_proof")
    .is("reversed_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function listProofPaymentsAwaitingFinance(): Promise<
  Array<{ payment: Payment; proof: InstallmentProofRow | null; ageMinutes: number }>
> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("payments")
    .select("*")
    .eq("payment_source", "student_proof")
    .eq("finance_verified", false)
    .is("reversed_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(200);
  const rows = (data || []) as Payment[];
  const out: Array<{ payment: Payment; proof: InstallmentProofRow | null; ageMinutes: number }> = [];
  for (const p of rows) {
    const proof = p.proof_id ? await getProofById(p.proof_id) : null;
    const ageMinutes = Math.max(0, Math.floor((Date.now() - new Date(p.created_at).getTime()) / 60_000));
    out.push({ payment: p, proof, ageMinutes });
  }
  return out;
}

export async function getProofRecordPreview(proofId: string): Promise<
  | {
      ok: true;
      proof: InstallmentProofRow;
      expected: { installmentNo: number; amount: number; due: string | null };
      claimed: { amount: number | null; date: string | null; utr: string | null };
      enrollment: {
        totalFee: number;
        amountPaid: number;
        outstanding: number;
        pctPaid: number;
        unpaidInstallments: Array<{ no: number; amount: number; due: string | null }>;
      };
      allocationNote: string | null;
      flagEnabled: boolean;
    }
  | { ok: false; error: string }
> {
  const proof = await getProofById(proofId);
  if (!proof) return { ok: false, error: "Proof not found." };
  const e = await getCourseEnrollmentById(proof.course_enrollment_id);
  if (!e) return { ok: false, error: "Enrollment not found." };
  const d = deriveEnrollment(e);
  const line =
    (e.schedule || []).find((s) => s.kind === "installment" && s.no === proof.installment_no) ||
    (e.schedule || [])[findOldestOutstandingIndex(e.schedule || [], "installment")];
  const unpaid = (e.schedule || [])
    .filter((s) => s.kind === "installment" && isLineOutstanding(s))
    .map((s) => ({ no: s.no, amount: s.amount, due: s.due ? String(s.due).slice(0, 10) : null }));

  let allocationNote: string | null = null;
  const oldest = unpaid[0];
  if (oldest && proof.installment_no !== oldest.no) {
    allocationNote = `Student marked instalment ${proof.installment_no}, but oldest unpaid is ${oldest.no} — allocation will clear #${oldest.no} first.`;
  }

  return {
    ok: true,
    proof,
    expected: {
      installmentNo: line?.no ?? proof.installment_no,
      amount: line?.amount ?? proof.claimed_amount ?? 0,
      due: line?.due ? String(line.due).slice(0, 10) : null,
    },
    claimed: {
      amount: proof.claimed_amount,
      date: proof.claimed_paid_date,
      utr: proof.reference_utr,
    },
    enrollment: {
      totalFee: e.total_fee,
      amountPaid: d.paid,
      outstanding: d.remaining,
      pctPaid: d.progressPct,
      unpaidInstallments: unpaid,
    },
    allocationNote,
    flagEnabled: await proofRecordsPaymentEnabled(),
  };
}
