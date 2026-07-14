/**
 * Real StatePort — reads CURRENT business truth READ-ONLY. It NEVER creates,
 * modifies, or deletes any payment/installment/enrollment/access/student record.
 * Everything here is a SELECT + a pure derive (deriveCollections). This is what
 * powers latest-state revalidation ("paid => stop the reminder").
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { deriveCollections } from "@/lib/installments";
import { getWebinarRegistrationIdsByPhone } from "@/lib/dataProvider";
import { isOptedOut } from "@/lib/sms/store";
import { normalizeIndianMobile } from "@/lib/phone";
import type { CourseEnrollment } from "@/lib/types";
import type { StatePort } from "./ports";
import type { EnrollmentRow, WorkflowRuntimeRow } from "./types";
import type { EligibilityFacts } from "./eligibility";
import type { LatestState } from "./latestState";
import type { AutomationEvent } from "@/types/journey-automation";

function valid10(phone: string | null): string | null {
  if (!phone) return null;
  const raw = normalizeIndianMobile(phone);
  const n = raw ? String(raw) : "";
  return /^\d{10}$/.test(n) ? n : null;
}

async function courseEnrollmentFor(ref: string | null, phone: string | null): Promise<CourseEnrollment | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  if (ref) {
    const { data } = await sb.from("course_enrollments").select("*").eq("id", ref).maybeSingle();
    if (data) return data as CourseEnrollment;
  }
  if (phone) {
    const { data } = await sb.from("course_enrollments").select("*").eq("phone", phone)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) return data as CourseEnrollment;
  }
  return null;
}

export const realState: StatePort = {
  async getEligibilityFacts(_workflow: WorkflowRuntimeRow, event: AutomationEvent): Promise<EligibilityFacts> {
    const normalized = valid10(event.phone);
    const optedOut = normalized ? await isOptedOut(normalized).catch(() => false) : false;
    // already-converted: if the triggering enrollment is already fully paid.
    let alreadyConverted = false;
    const enr = await courseEnrollmentFor(event.enrollment_id, normalized).catch(() => null);
    if (enr) alreadyConverted = deriveCollections(enr).isFullyPaid;
    return {
      normalizedPhone: normalized,
      phoneValid: !!normalized,
      optedOut,
      isStaffOrTest: false, // staff/test lists integrate later; canary test-phones cover the near-term need
      alreadyEnrolledActive: false, // enforced by the DB partial-unique index on createEnrollment
      alreadyConverted,
      canaryAllowed: true, // computed by the matcher from canary caps
    };
  },

  async getLatestState(enrollment: EnrollmentRow): Promise<LatestState> {
    const phone = enrollment.normalized_phone;
    const optedOut = phone ? await isOptedOut(phone).catch(() => false) : false;

    // Real webinar-registration read (existing query). If the enrollment names a
    // target webinar we check membership; otherwise we report "registered for any".
    const ctx = (enrollment.context ?? {}) as Record<string, unknown>;
    const targetWebinarId = (ctx["webinar_id"] as string | null)
      ?? ((ctx["payload"] as Record<string, unknown> | undefined)?.["webinar_id"] as string | null | undefined)
      ?? null;
    let registeredForWebinar = false;
    if (phone) {
      const regs = await getWebinarRegistrationIdsByPhone(phone).catch(() => new Set<string>());
      registeredForWebinar = targetWebinarId ? regs.has(targetWebinarId) : regs.size > 0;
    }

    const enr = await courseEnrollmentFor(enrollment.enrollment_ref, phone).catch(() => null);
    if (!enr) {
      return { paid: false, hasOverdue: false, optedOut, enrolledInCourse: false, registeredForWebinar, planPausedOrWaived: false };
    }
    const d = deriveCollections(enr);
    const planPausedOrWaived = enr.status === "cancelled" || (enr.schedule || []).some((s) => s.status === "waived");
    return {
      paid: d.isFullyPaid,
      hasOverdue: d.hasOverdue,
      optedOut,
      enrolledInCourse: enr.status !== "cancelled",
      registeredForWebinar,
      planPausedOrWaived,
    };
  },
};
