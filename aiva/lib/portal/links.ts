/**
 * Portal deep-link builder. AIVA never acts — these are NAVIGATION links that open the real
 * namanias.com admin portal in a new tab. Each link is verified against an EXISTING portal route.
 *
 * Route reality (checked against app/admin/**):
 *   - /admin/students/[id]                   RECORD-level (needs students.id; resolved by phone)
 *   - /admin/students                        LIST-level  (fallback; page filters client-side, no URL query)
 *   - /admin/webinars/[id]/registrations     RECORD-level (webinar_id is on the registration row)
 *   - /admin/courses/[id]/edit               RECORD-level (course_id is on the enrollment row)
 *   - /admin/payments                        LIST-level  (no per-student URL filter in the portal)
 *   - /admin/webinars                        LIST-level
 * Pure + tested: buildable without a browser; only string composition.
 */

export type PortalLinkLevel = "record" | "list";
export type PortalLink = { key: string; label: string; href: string; level: PortalLinkLevel };

export const PORTAL_ORIGIN = (process.env.NEXT_PUBLIC_PORTAL_ORIGIN || "https://www.namanias.com").replace(/\/+$/, "");

function abs(path: string): string {
  return `${PORTAL_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Student profile (money, enrollments, access). Record-level when we resolved a students.id. */
export function studentLink(studentId?: string | null): PortalLink {
  if (studentId) return { key: "student", label: "Open student", href: abs(`/admin/students/${studentId}`), level: "record" };
  return { key: "student", label: "Open students", href: abs(`/admin/students`), level: "list" };
}

/** Payments/Finance tab. List-level only — the portal Payments page has no per-student URL filter. */
export function paymentsLink(): PortalLink {
  return { key: "payments", label: "Open in Payments", href: abs(`/admin/payments`), level: "list" };
}

/** Payment proofs live on the Payments page (no dedicated route). List-level. */
export function proofsLink(): PortalLink {
  return { key: "proofs", label: "Open proof queue", href: abs(`/admin/payments`), level: "list" };
}

/** A specific webinar's registrant admin page. Record-level via webinar id. */
export function webinarLink(webinarId?: string | null): PortalLink {
  if (webinarId) return { key: "webinar", label: "Open webinar", href: abs(`/admin/webinars/${webinarId}/registrations`), level: "record" };
  return { key: "webinar", label: "Open webinars", href: abs(`/admin/webinars`), level: "list" };
}

/** A specific course/batch admin page. Record-level via course id (batches live inside the course). */
export function courseLink(courseId?: string | null): PortalLink {
  if (courseId) return { key: "course", label: "Open batch", href: abs(`/admin/courses/${courseId}/edit`), level: "record" };
  return { key: "course", label: "Open courses", href: abs(`/admin/courses`), level: "list" };
}

/** Compose the contextual link set for a stitched record (skips links with no id when appropriate). */
export function recordLinks(ctx: {
  studentId?: string | null;
  webinarId?: string | null;
  courseId?: string | null;
  showPayments?: boolean;
}): PortalLink[] {
  const out: PortalLink[] = [studentLink(ctx.studentId)];
  if (ctx.showPayments !== false) out.push(paymentsLink());
  if (ctx.webinarId) out.push(webinarLink(ctx.webinarId));
  if (ctx.courseId) out.push(courseLink(ctx.courseId));
  return out;
}
