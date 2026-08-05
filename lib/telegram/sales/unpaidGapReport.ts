/**
 * Read-only: unpaid enrollments excluded by the pinned isActiveEnrollment filter.
 * Does not widen the filter or write anything.
 */
import { getAllCourseEnrollments, getPayments } from "../../dataProvider";
import { isActiveEnrollment } from "../../installments";
import { isPaidStatus } from "../../paymentsAgg";
import { getSupabaseAdmin } from "../../supabase";

export async function reportUnpaidInvariantGap(): Promise<{
  unpaidExcluded: number;
  withPaymentOrApprovedProof: number;
  samples: {
    id: string;
    name: string;
    phone: string;
    status: string;
    amount_paid: number;
    hasPaidPayment: boolean;
    hasApprovedProof: boolean;
  }[];
  note: string;
}> {
  const [enrollments, payments] = await Promise.all([getAllCourseEnrollments(), getPayments()]);
  const unpaid = enrollments.filter((e) => {
    if (e.status === "cancelled" || e.status === "transferred_out") return false;
    return !isActiveEnrollment(e);
  });

  const db = getSupabaseAdmin();
  const approvedProofEnrollmentIds = new Set<string>();
  if (db) {
    try {
      const { data } = await db
        .from("installment_payment_proofs")
        .select("course_enrollment_id,status")
        .in("status", ["approved", "accepted", "accepted_as_partial", "recorded"]);
      for (const r of data || []) {
        if (r.course_enrollment_id) approvedProofEnrollmentIds.add(String(r.course_enrollment_id));
      }
    } catch {
      /* best effort */
    }
  }

  const samples: {
    id: string;
    name: string;
    phone: string;
    status: string;
    amount_paid: number;
    hasPaidPayment: boolean;
    hasApprovedProof: boolean;
  }[] = [];

  let withPaymentOrApprovedProof = 0;
  for (const e of unpaid) {
    const phone = String(e.phone || "").replace(/\D/g, "").slice(-10);
    const hasPaidPayment = payments.some(
      (p) =>
        !p.deleted_at &&
        isPaidStatus(p.status) &&
        (p.enrollment_id === e.id ||
          (phone &&
            String(p.phone || "").replace(/\D/g, "").slice(-10) === phone &&
            (p.item_slug === e.course_slug || p.item === e.course_title))),
    );
    const hasApprovedProof = approvedProofEnrollmentIds.has(e.id);
    if (hasPaidPayment || hasApprovedProof) {
      withPaymentOrApprovedProof++;
      if (samples.length < 15) {
        samples.push({
          id: e.id,
          name: e.student_name,
          phone: e.phone,
          status: String(e.status || ""),
          amount_paid: Number(e.amount_paid) || 0,
          hasPaidPayment,
          hasApprovedProof,
        });
      }
    }
  }

  return {
    unpaidExcluded: unpaid.length,
    withPaymentOrApprovedProof,
    samples,
    note:
      "Filter is isActiveEnrollment only (intentional). Unpaid rows are unchecked. Report-only — filter not widened.",
  };
}
