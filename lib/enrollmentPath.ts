/**
 * Enrollment checkout routes. Pure path matching so the public nav and floating
 * actions can compact themselves on checkout without touching other pages.
 */
export function enrollmentBackHref(pathname: string | null | undefined): string | null {
  const p = (pathname || "").split("?")[0].split("#")[0];
  const course = p.match(/^\/courses\/([^/]+)\/enroll\/?$/);
  if (course?.[1]) return `/courses/${course[1]}`;
  const legacy = p.match(/^\/enroll\/([^/]+)\/?$/);
  if (legacy?.[1]) return `/courses/${legacy[1]}`;
  return null;
}

export function isEnrollmentCheckoutPath(pathname: string | null | undefined): boolean {
  return enrollmentBackHref(pathname) != null;
}
