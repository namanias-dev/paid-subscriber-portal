/**
 * Production finalize: calls finalize_course_payment() RPC.
 */
import "server-only";
import { getSupabaseAdmin } from "../supabase";
import type { CourseEnrollment, PaymentReceipt } from "../types";
import type { FinalizeCoursePaymentResult, FinalizeOutcome } from "./types";

export type { FinalizeCoursePaymentResult, FinalizeOutcome } from "./types";
export { finalizeCoursePaymentDemo, resetDemoFinalizeLedger } from "./demoFinalize";

function mapEnrollment(raw: Record<string, unknown>, fallback?: CourseEnrollment | null): CourseEnrollment {
  const base = fallback || ({} as CourseEnrollment);
  return {
    ...base,
    id: String(raw.id || base.id),
    schedule: (raw.schedule as CourseEnrollment["schedule"]) || base.schedule || [],
    amount_paid: Number(raw.amount_paid ?? base.amount_paid ?? 0),
    status: String(raw.status || base.status) as CourseEnrollment["status"],
    total_fee: Number(raw.total_fee ?? base.total_fee ?? 0),
    phone: String(raw.phone || base.phone || ""),
    student_name: String(raw.student_name || base.student_name || ""),
    email: (raw.email as string | null) ?? base.email ?? null,
    course_title: String(raw.course_title || base.course_title || ""),
    course_slug: String(raw.course_slug || base.course_slug || ""),
    batch_label: (raw.batch_label as string | null) ?? base.batch_label ?? null,
    plan_type: (raw.plan_type as CourseEnrollment["plan_type"]) || base.plan_type,
    discount_amount: Number(raw.discount_amount ?? base.discount_amount ?? 0),
  };
}

function mapReceipt(raw: Record<string, unknown> | null | undefined): PaymentReceipt | null {
  if (!raw) return null;
  return raw as unknown as PaymentReceipt;
}

export async function finalizeCoursePaymentAtomic(referenceNo: string): Promise<FinalizeCoursePaymentResult> {
  const ref = (referenceNo || "").trim();
  if (!ref) return { ok: false, outcome: "not_found", enrollment: null, receipt: null, error: "missing_reference" };
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, outcome: "error", enrollment: null, receipt: null, error: "no_db" };

  const { data, error } = await db.rpc("finalize_course_payment", { p_reference_no: ref });
  if (error) {
    return { ok: false, outcome: "error", enrollment: null, receipt: null, error: error.message };
  }
  const payload = (data || {}) as Record<string, unknown>;
  if (!payload.ok) {
    return {
      ok: false,
      outcome: (String(payload.outcome || "error") as FinalizeOutcome) || "error",
      enrollment: null,
      receipt: null,
      error: String(payload.error || "finalize_failed"),
    };
  }
  const enrRaw = payload.enrollment as Record<string, unknown> | undefined;
  const receipt = mapReceipt(payload.receipt as Record<string, unknown> | undefined);
  return {
    ok: true,
    outcome: String(payload.outcome || "created") as FinalizeOutcome,
    enrollment: enrRaw ? mapEnrollment(enrRaw) : null,
    receipt,
    allocatedAmount: Number(payload.allocated_amount || 0) || undefined,
  };
}
