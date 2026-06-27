import {
  getPaidPurchaseForPhone,
  getActiveStaffGrantsByPhone,
  getWebinarBySlug,
  getCourseBySlug,
  getWebinarRegistrationIdsByPhone,
} from "./dataProvider";
import type { Payment } from "./types";

export interface PortalItemAccess {
  ok: boolean;
  /** Raw payment item_type for paid rows; "course"/"webinar" for staff comp. */
  itemType: "course" | "plan" | "webinar" | null;
  /** Item slug used to load the course/webinar content. */
  slug: string;
  /** The PAID payment row (paying students). Null for staff comp access. */
  purchase: Payment | null;
  /** True when access is granted via STAFF comp (no payment, no side effects). */
  isStaff: boolean;
  /** Display title fallback when there's no payment row (staff). */
  title: string | null;
}

const DENY: PortalItemAccess = { ok: false, itemType: null, slug: "", purchase: null, isStaff: false, title: null };

/**
 * SINGLE source of truth for "can this logged-in portal user open this item's
 * FULL content?" Used by the portal item page so a paid student and a comped
 * staff member get the identical rendered experience (Zoom link, thumbnails,
 * materials, everything).
 *
 * Order is deliberate and additive:
 *   1) PAID student — checked FIRST and byte-for-byte the original logic
 *      (`getPaidPurchaseForPhone`), so NOTHING changes for paying users.
 *   2) STAFF comp — only when there's no paid purchase. Access is derived from
 *      being staff (phone → linked admin → staff_access_grants), NEVER from a
 *      fabricated payment/seat/revenue record. Here `reference` is the item slug.
 */
export async function resolvePortalItemAccess(reference: string, phone: string): Promise<PortalItemAccess> {
  const ref = (reference || "").trim();
  const ph = (phone || "").trim();
  if (!ref || !ph) return DENY;

  // 1) Paying student — unchanged.
  const purchase = await getPaidPurchaseForPhone(ref, ph);
  if (purchase) {
    return { ok: true, itemType: purchase.item_type, slug: purchase.item_slug || "", purchase, isStaff: false, title: purchase.item || null };
  }

  // 2) Staff comp access — additive; reference is the item slug.
  const staff = await getActiveStaffGrantsByPhone(ph);
  if (staff.webinarIds.length) {
    const webinar = await getWebinarBySlug(ref);
    if (webinar && staff.webinarIds.includes(webinar.id)) {
      return { ok: true, itemType: "webinar", slug: webinar.slug, purchase: null, isStaff: true, title: webinar.title };
    }
  }
  if (staff.courseIds.length) {
    const course = await getCourseBySlug(ref);
    if (course && staff.courseIds.includes(course.id)) {
      return { ok: true, itemType: "course", slug: course.slug, purchase: null, isStaff: true, title: course.title };
    }
  }

  // 3) FREE webinar by registration — genuinely-free content gated on an is-free
  // (price ≤ 0) + registration check, NOT the paid default-deny. Lets leads/free
  // users open the free webinars they registered for. Paid items are untouched.
  const webinar = await getWebinarBySlug(ref);
  if (webinar && (webinar.price ?? 0) <= 0) {
    const regIds = await getWebinarRegistrationIdsByPhone(ph);
    if (regIds.has(webinar.id)) {
      return { ok: true, itemType: "webinar", slug: webinar.slug, purchase: null, isStaff: false, title: webinar.title };
    }
  }

  return DENY;
}
