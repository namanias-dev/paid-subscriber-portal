import {
  getAccessOverridesByPhone,
  getAllCourses,
  getCourseEnrollmentsByPhone,
  getPayments,
  getPaymentsByPhone,
  getWebinars,
} from "../../dataProvider";
import { lectureAccessForCourse } from "../../entitlements";
import { deriveEnrollment, isActiveEnrollment, isLineOutstanding } from "../../installments";
import { isPaidStatus } from "../../paymentsAgg";
import type { CourseEnrollment, Payment } from "../../types";
import { paidWebinarRegistrationCount } from "../../webinarReg";

export interface EnrollmentSalesContext {
  enrollment: CourseEnrollment;
  totalFee: number | null;
  paid: number | null;
  balance: number | null;
  installmentTotal: number | null;
  nextInstallmentDate: string | null;
  dueDate: string | null;
  accessStatus: "active" | "blocked" | null;
  plan: "full" | "instalment" | null;
}

function phone10(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "").slice(-10);
}

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const ENROLLMENT_CONTEXT_TTL_MS = 15_000;
const enrollmentContextCache = new Map<
  string,
  { at: number; value: Promise<EnrollmentSalesContext | null> }
>();

function matchingEnrollment(
  rows: CourseEnrollment[],
  opts: { enrollmentId?: string | null; course?: string | null },
): CourseEnrollment | null {
  if (opts.enrollmentId) {
    const exact = rows.find((e) => e.id === opts.enrollmentId);
    if (exact) return exact;
  }
  const course = String(opts.course || "").trim().toLowerCase();
  return (
    rows.find(
      (e) =>
        isActiveEnrollment(e) &&
        (!course ||
          e.course_id.toLowerCase() === course ||
          e.course_slug.toLowerCase() === course ||
          e.course_title.toLowerCase() === course),
    ) || null
  );
}

export async function loadEnrollmentSalesContext(opts: {
  phone: string;
  course?: string | null;
  enrollmentId?: string | null;
  enrollment?: CourseEnrollment | null;
  installmentNo?: number | null;
}): Promise<EnrollmentSalesContext | null> {
  const phone = phone10(opts.phone);
  if (!phone) return null;
  const cacheKey = `${phone}:${opts.enrollment?.id || opts.enrollmentId || opts.course || ""}`;
  const cached = enrollmentContextCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ENROLLMENT_CONTEXT_TTL_MS) return cached.value;
  const value = loadEnrollmentSalesContextUncached(opts, phone);
  enrollmentContextCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function loadEnrollmentSalesContextUncached(
  opts: {
    phone: string;
    course?: string | null;
    enrollmentId?: string | null;
    enrollment?: CourseEnrollment | null;
    installmentNo?: number | null;
  },
  phone: string,
): Promise<EnrollmentSalesContext | null> {
  const [rows, courses, overrides] = await Promise.all([
    opts.enrollment ? Promise.resolve([opts.enrollment]) : getCourseEnrollmentsByPhone(phone),
    getAllCourses(),
    getAccessOverridesByPhone(phone),
  ]);
  const enrollment = opts.enrollment || matchingEnrollment(rows, opts);
  if (!enrollment) return null;
  const derived = deriveEnrollment(enrollment);
  const course = courses.find(
    (c) =>
      c.id === enrollment.course_id ||
      c.slug === enrollment.course_slug ||
      c.title === enrollment.course_title,
  );
  const override = overrides.find((o) => o.course_id === enrollment.course_id);
  const access = lectureAccessForCourse(course, enrollment, override, false);
  const outstanding = (enrollment.schedule || [])
    .filter((line) => line.kind !== "seat" && isLineOutstanding(line))
    .sort((a, b) => String(a.due || "").localeCompare(String(b.due || "")));
  const installmentTotal =
    positive(enrollment.installment_count) ||
    (enrollment.schedule || []).filter((line) => line.kind !== "seat").length ||
    null;
  return {
    enrollment,
    totalFee: positive(enrollment.total_fee),
    paid: positive(derived.paid),
    balance: positive(derived.remaining),
    installmentTotal,
    nextInstallmentDate: outstanding[0]?.due || null,
    dueDate:
      (opts.installmentNo != null
        ? (enrollment.schedule || []).find((line) => line.no === opts.installmentNo)?.due
        : null) ||
      outstanding[0]?.due ||
      null,
    accessStatus: access.allowed ? "active" : "blocked",
    plan:
      enrollment.payment_plan === "FULL" || enrollment.plan_type === "full"
        ? "full"
        : enrollment.payment_plan === "EMI" ||
            enrollment.payment_plan === "CUSTOM_INSTALLMENTS" ||
            enrollment.plan_type === "emi"
          ? "instalment"
          : null,
  };
}

export async function loadFailureSalesContext(opts: {
  phone: string;
  course: string;
  at?: string | Date | null;
}): Promise<{ attemptToday: number | null; paidBefore: boolean | null }> {
  const phone = phone10(opts.phone);
  if (!phone) return { attemptToday: null, paidBefore: null };
  const rows = await getPaymentsByPhone(phone);
  const at = opts.at ? new Date(opts.at).getTime() : Date.now();
  const date = new Date(at);
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const course = opts.course.trim().toLowerCase();
  const attempts = rows.filter((p) => {
    const pYmd = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(p.created_at));
    const sameCourse =
      !course ||
      String(p.item || "").trim().toLowerCase() === course ||
      String(p.item_slug || "").trim().toLowerCase() === course;
    return sameCourse && pYmd === ymd && new Date(p.created_at).getTime() <= at;
  });
  return {
    attemptToday: attempts.length || null,
    paidBefore: rows.some((p) => isPaidStatus(p.status) && new Date(p.created_at).getTime() < at),
  };
}

export function classifyCheckoutLead(
  payment: Payment,
  allPayments: readonly Payment[],
): "new lead" | "returning" {
  const phone = phone10(payment.phone);
  const at = new Date(payment.created_at).getTime();
  return allPayments.some(
    (p) =>
      p.id !== payment.id &&
      phone10(p.phone) === phone &&
      new Date(p.created_at).getTime() < at,
  )
    ? "returning"
    : "new lead";
}

export async function loadWebinarProofSalesContext(payment: Payment): Promise<{
  webinarName: string | null;
  webinarDate: string | null;
  amount: number | null;
  registrations: number | null;
}> {
  const [webinars, payments] = await Promise.all([getWebinars(), getPayments()]);
  const key = String(payment.item_slug || payment.item || "").trim().toLowerCase();
  const webinar =
    webinars.find(
      (w) =>
        w.id.toLowerCase() === key ||
        w.slug.toLowerCase() === key ||
        w.title.toLowerCase() === key,
    ) || null;
  return {
    webinarName: webinar?.title || payment.item || null,
    webinarDate: webinar?.datetime || null,
    amount: positive(payment.amount),
    registrations: key ? paidWebinarRegistrationCount(payments, key) : null,
  };
}

export function findEnrollmentFromSnapshot(
  enrollments: readonly CourseEnrollment[],
  payment: Payment,
): CourseEnrollment | null {
  const phone = phone10(payment.phone);
  return (
    enrollments.find(
      (e) =>
        isActiveEnrollment(e) &&
        (e.id === payment.enrollment_id ||
          (phone10(e.phone) === phone &&
            (e.course_slug === payment.item_slug || e.course_title === payment.item))),
    ) || null
  );
}

export function enrollmentContextFromSnapshot(
  enrollment: CourseEnrollment,
  accessStatus?: "active" | "blocked" | null,
): EnrollmentSalesContext {
  const derived = deriveEnrollment(enrollment);
  const outstanding = (enrollment.schedule || [])
    .filter((line) => line.kind !== "seat" && isLineOutstanding(line))
    .sort((a, b) => String(a.due || "").localeCompare(String(b.due || "")));
  const installmentTotal =
    positive(enrollment.installment_count) ||
    (enrollment.schedule || []).filter((line) => line.kind !== "seat").length ||
    null;
  return {
    enrollment,
    totalFee: positive(enrollment.total_fee),
    paid: positive(derived.paid),
    balance: positive(derived.remaining),
    installmentTotal,
    nextInstallmentDate: outstanding[0]?.due || null,
    dueDate: outstanding[0]?.due || null,
    accessStatus: accessStatus ?? null,
    plan:
      enrollment.payment_plan === "FULL" || enrollment.plan_type === "full"
        ? "full"
        : "instalment",
  };
}
