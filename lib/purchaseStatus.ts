import { getBuyerSession } from "./session";
import {
  getBuyerPurchases,
  getCourseEnrollmentsByPhone,
  getWebinarRegistrationIdsByPhone,
  getWebinarPaymentStatusMap,
  type WebinarPayClass,
} from "./dataProvider";
import { deriveEnrollment } from "./installments";
import type { Course, CourseEnrollment, Webinar } from "./types";

/**
 * A serializable, client-safe view of a logged-in buyer's status for a single
 * course. Computed from the SAME ledger as "My Courses" (course_enrollments +
 * paid one-time payments) so cards, detail pages, and the portal never mismatch.
 */
export interface CoursePurchaseView {
  /** Pill text, e.g. "Seat booked", "Installment 2 of 6 paid", "Enrolled". */
  label: string;
  /** Primary CTA label, e.g. "Continue", "Go to Class Hub", "Pay balance". */
  cta: string;
  /** Where the CTA / card should link (portal). */
  href: string;
  /** True when access to the Class Hub is already unlocked. */
  unlocked: boolean;
  /** Outstanding balance (0 for fully paid / one-time). */
  remaining: number;
}

export interface PurchaseSnapshot {
  phone: string;
  /** Latest active enrollment per course slug. */
  enrollmentBySlug: Map<string, CourseEnrollment>;
  /** Course slugs paid via a one-time payment that has no EMI enrollment. */
  paidCourseSlugs: Set<string>;
  /** Webinar slugs the buyer paid for. */
  webinarSlugs: Set<string>;
  /** Webinar IDs the buyer has a registration row for (free OR a started paid attempt). */
  webinarIds: Set<string>;
  /** Latest payment outcome per webinar slug (PAID wins > PENDING > FAILED). */
  webinarPaymentStatus: Map<string, WebinarPayClass>;
}

/**
 * Build a purchase snapshot for the currently logged-in BUYER (portal session).
 * Returns null when logged out — callers then render the normal price/CTA.
 */
export async function getPurchaseSnapshot(): Promise<PurchaseSnapshot | null> {
  const session = await getBuyerSession();
  if (!session?.phone) return null;
  const phone = session.phone;

  const [purchases, enrollments, webinarIds, webinarPaymentStatus] = await Promise.all([
    getBuyerPurchases(phone),
    getCourseEnrollmentsByPhone(phone),
    getWebinarRegistrationIdsByPhone(phone),
    getWebinarPaymentStatusMap(phone),
  ]);

  // Latest active enrollment per slug (course_enrollments is the rich source).
  const enrollmentBySlug = new Map<string, CourseEnrollment>();
  for (const e of enrollments) {
    if (e.status === "cancelled" || e.amount_paid <= 0) continue;
    const prev = enrollmentBySlug.get(e.course_slug);
    if (!prev || new Date(e.created_at) > new Date(prev.created_at)) enrollmentBySlug.set(e.course_slug, e);
  }

  const paidCourseSlugs = new Set<string>();
  const webinarSlugs = new Set<string>();
  for (const p of purchases) {
    const slug = p.item_slug?.trim();
    if (!slug) continue;
    if (p.item_type === "course" && !p.enrollment_id) paidCourseSlugs.add(slug);
    if (p.item_type === "webinar") webinarSlugs.add(slug);
  }

  return { phone, enrollmentBySlug, paidCourseSlugs, webinarSlugs, webinarIds, webinarPaymentStatus };
}

/** Resolve a course's purchase view from a snapshot (pure). Null = not purchased. */
export function coursePurchaseView(
  course: Pick<Course, "id" | "slug">,
  snap: PurchaseSnapshot | null
): CoursePurchaseView | null {
  if (!snap) return null;

  const enr = snap.enrollmentBySlug.get(course.slug);
  if (enr) {
    const d = deriveEnrollment(enr);
    if (d.isFullyPaid) {
      return {
        label: "Enrolled",
        cta: "Go to Class Hub",
        href: `/portal/class/${course.id}`,
        unlocked: true,
        remaining: 0,
      };
    }
    if (enr.status === "seat_booked") {
      return {
        label: "Seat booked",
        cta: "Pay balance",
        href: `/portal/course/${enr.id}`,
        unlocked: true,
        remaining: d.remaining,
      };
    }
    // partially paid
    return {
      label: d.installmentTotal > 0 ? `Installment ${d.paidCount} of ${d.installmentTotal} paid` : "Payment in progress",
      cta: "Pay balance",
      href: `/portal/course/${enr.id}`,
      unlocked: true,
      remaining: d.remaining,
    };
  }

  // Legacy one-time paid course (no EMI enrollment record).
  if (snap.paidCourseSlugs.has(course.slug)) {
    return {
      label: "Enrolled",
      cta: "Go to Class Hub",
      href: `/portal/class/${course.id}`,
      unlocked: true,
      remaining: 0,
    };
  }

  return null;
}

/** Where this buyer stands on a specific webinar. */
export type WebinarRegStatus =
  | "registered" // PAID (any webinar) or a registration row for a FREE webinar
  | "pending"    // PAID webinar with an in-flight (PENDING) payment, not yet confirmed
  | "failed"     // PAID webinar whose last payment FAILED — offer retry
  | "none";      // not started (show the register/pay form)

/**
 * Canonical registration status for a webinar.
 * - PAID always wins (edge case: a paid row + any pending/failed → registered).
 * - FREE webinars: a registration row IS the confirmation.
 * - PAID webinars: ONLY a confirmed PAID payment counts as registered. A bare
 *   `webinar_registrations` lead row (created before checkout) does NOT.
 */
export function webinarStatus(
  webinar: Pick<Webinar, "id" | "slug" | "price">,
  snap: PurchaseSnapshot | null
): WebinarRegStatus {
  if (!snap) return "none";
  const pay = snap.webinarPaymentStatus.get(webinar.slug);
  if (pay === "PAID" || snap.webinarSlugs.has(webinar.slug)) return "registered";
  if ((webinar.price ?? 0) <= 0) {
    return snap.webinarIds.has(webinar.id) ? "registered" : "none";
  }
  if (pay === "PENDING") return "pending";
  if (pay === "FAILED") return "failed";
  return "none";
}

/** True only when the buyer is actually registered (paid, or free-confirmed). */
export function webinarPurchased(
  webinar: Pick<Webinar, "id" | "slug" | "price">,
  snap: PurchaseSnapshot | null
): boolean {
  return webinarStatus(webinar, snap) === "registered";
}

/** Build a slug→view record for a list of courses (serializable for client). */
export function coursePurchaseMap(
  courses: Pick<Course, "id" | "slug">[],
  snap: PurchaseSnapshot | null
): Record<string, CoursePurchaseView> {
  const out: Record<string, CoursePurchaseView> = {};
  if (!snap) return out;
  for (const c of courses) {
    const v = coursePurchaseView(c, snap);
    if (v) out[c.slug] = v;
  }
  return out;
}
