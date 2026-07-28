/**
 * Fixture guard — refuses to publish `lib/mockData.ts` rows on a public page.
 *
 * WHY: `lib/dataProvider.ts` contains six readers that silently substitute mock
 * fixtures when their table returns zero rows. Two of them feed this page:
 *
 *   lib/dataProvider.ts:1433  getAllCourses   → [...mock.courses]
 *   lib/dataProvider.ts:2349  getAllWebinars  → [...mock.webinars]
 *
 * That fallback has already put fixture data in front of users twice elsewhere in
 * this project. On a marketing page it would be a false PUBLIC claim, so this
 * module is the last line of defence. It adds NO new reader — it only inspects
 * rows that have already been fetched.
 *
 * WHAT IT DOES NOT DO: it does not try to purge the production catalogue. A
 * separate finding (reported, not fixed — that cleanup is parked pending a
 * product decision) is that the seed fixtures were loaded into the real database
 * and then partially adopted: the `co-*` course rows have had prices, titles and
 * `active` flags edited by the admin, so they are the academy's live catalogue
 * now, not phantom data. Deleting them from the preview would misrepresent the
 * catalogue rather than clean it up.
 *
 * So the guard is deliberately narrow and targets only what is unambiguous:
 *
 *   1. WHOLESALE FALLBACK — if every row we got back is a known fixture id, the
 *      reader almost certainly fell through to mock data. We publish nothing.
 *   2. FABRICATED ENGAGEMENT METRICS — a webinar whose `registrations` counter was
 *      hand-set (`registrations_source = 'aggregate_manual'`) while it has no
 *      real registration rows behind it. Those counters are the 2,825 fabricated
 *      registrations from the prior audit, and they are never rendered.
 */
import * as mock from "@/lib/mockData";
import type { Course, Webinar } from "@/lib/types";

const MOCK_COURSE_IDS: ReadonlySet<string> = new Set(mock.courses.map((c) => c.id));
const MOCK_WEBINAR_IDS: ReadonlySet<string> = new Set(mock.webinars.map((w) => w.id));

export function isFixtureCourseId(id: string): boolean {
  return MOCK_COURSE_IDS.has(id);
}

export function isFixtureWebinarId(id: string): boolean {
  return MOCK_WEBINAR_IDS.has(id);
}

/**
 * True when the row set looks like the mock-fallback rather than a real table.
 * Requires a non-empty set in which EVERY row is a known fixture id — a real
 * table that happens to contain some seeded rows alongside admin-created ones
 * (which is the actual production state) does not trip this.
 */
export function isWholesaleFallback(ids: string[], fixtureIds: ReadonlySet<string>): boolean {
  if (ids.length === 0) return false;
  return ids.every((id) => fixtureIds.has(id));
}

export function coursesAreFallback(courses: Course[]): boolean {
  return isWholesaleFallback(courses.map((c) => c.id), MOCK_COURSE_IDS);
}

export function webinarsAreFallback(webinars: Webinar[]): boolean {
  return isWholesaleFallback(webinars.map((w) => w.id), MOCK_WEBINAR_IDS);
}

/**
 * A registration counter we are NOT willing to publish.
 *
 * `registrations_source === "aggregate_manual"` means a human typed the number
 * in. Combined with the fact that these rows have zero rows in
 * `webinar_registrations`, the counter is unverifiable, so we treat the webinar
 * as having no publishable count at all.
 */
export function hasFabricatedRegistrationCount(w: Webinar): boolean {
  const source = (w as Webinar & { registrations_source?: string | null }).registrations_source;
  if (source === "aggregate_manual") return true;
  // A fixture row's counter is a fixture number by definition.
  return isFixtureWebinarId(w.id) && (w.registrations ?? 0) > 0;
}

export interface GuardResult<T> {
  rows: T[];
  /** True when the whole set was rejected as a mock-fallback. */
  suppressed: boolean;
  reason: string;
}

export function guardCourses(courses: Course[]): GuardResult<Course> {
  if (coursesAreFallback(courses)) {
    return {
      rows: [],
      suppressed: true,
      reason: "every course row matched a lib/mockData.ts fixture id — treating as dataProvider:1433 mock fallback",
    };
  }
  return { rows: courses, suppressed: false, reason: "real table (contains admin-created rows)" };
}

export function guardWebinars(webinars: Webinar[]): GuardResult<Webinar> {
  if (webinarsAreFallback(webinars)) {
    return {
      rows: [],
      suppressed: true,
      reason: "every webinar row matched a lib/mockData.ts fixture id — treating as dataProvider:2349 mock fallback",
    };
  }
  // Drop rows whose only reason to exist is a hand-typed engagement number.
  const rows = webinars.filter((w) => !(isFixtureWebinarId(w.id) && hasFabricatedRegistrationCount(w)));
  return {
    rows,
    suppressed: false,
    reason: `real table; dropped ${webinars.length - rows.length} fixture row(s) carrying hand-set registration counters`,
  };
}
