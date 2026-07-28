/**
 * Live offer derivation for the cinematic home preview.
 *
 * WHY THIS EXISTS: the hero's three CTAs and the "Where are you now?" selector
 * must point at offers that are actually open for business RIGHT NOW. Two things
 * make that non-trivial on this codebase:
 *
 *   1. The ₹50 masterclass is sold as a WEBINAR, and each session is a separate
 *      row. The admin-configured hero button href is a hardcoded absolute URL to
 *      one specific session, so it goes stale the moment that session ends.
 *      (At the time of writing, production's hero ₹50 button points at
 *      `upsc-full-masterclass-by-naman-sir-july-25`, which is `completed`.)
 *   2. `courses.status='published'` does NOT mean bookable — `active` is the
 *      real switch, and several published Foundation courses are `active:false`.
 *
 * So every price and destination here is DERIVED from the live rows, never
 * hardcoded. There is exactly one hardcoded string in this module: the `/quizzes`
 * route, which is a static site route and not a commercial offer.
 *
 * These are pure functions over already-fetched rows — they add NO new data
 * reader, and in particular add no seventh mock-fallback reader to
 * `lib/dataProvider.ts`.
 */
import type { Course, Webinar } from "@/lib/types";
import { effectiveRegStatus } from "@/lib/webinarLifecycle";

/** A destination we are willing to put in front of a user. */
export interface LiveOffer {
  kind: "webinar" | "course" | "route";
  label: string;
  href: string;
  /** Rupee price when the offer has one. `null` for free/route destinations. */
  price: number | null;
  /** Struck-through "was" price, only when strictly greater than `price`. */
  originalPrice: number | null;
  /** ISO start instant, when the offer is a dated session/batch. */
  startsAt: string | null;
  /** Real remaining seats. Only ever set when the row genuinely carries one. */
  seatsLeft: number | null;
  /** Row identity, for analytics props (never PII). */
  slug: string;
}

function isBookableCourse(c: Course): boolean {
  return c.status === "published" && c.active !== false;
}

/**
 * A webinar we can still sell. Uses the SHARED lifecycle helper rather than
 * re-deriving "is it open", so the preview can never disagree with the webinar
 * page or the payment API about whether registration is open.
 */
function isOpenWebinar(w: Webinar, now: number): boolean {
  return effectiveRegStatus(w, now) === "OPEN";
}

function byStartAsc(a: string | null, b: string | null): number {
  const ta = a ? Date.parse(a) : Number.POSITIVE_INFINITY;
  const tb = b ? Date.parse(b) : Number.POSITIVE_INFINITY;
  return (Number.isNaN(ta) ? Number.POSITIVE_INFINITY : ta) - (Number.isNaN(tb) ? Number.POSITIVE_INFINITY : tb);
}

function seatsOf(capacity: number | null | undefined, seatsLeft: number | null | undefined): number | null {
  // Only surface a seat count when BOTH a capacity and a positive remainder are
  // present. A null/0/negative remainder is treated as "unknown", never as
  // "hurry, 0 left" — that would be manufactured urgency.
  if (typeof seatsLeft !== "number" || !Number.isFinite(seatsLeft) || seatsLeft <= 0) return null;
  if (typeof capacity !== "number" || !Number.isFinite(capacity) || capacity <= 0) return null;
  if (seatsLeft > capacity) return null;
  return seatsLeft;
}

/**
 * The cheapest paid, still-open masterclass session — this is the real "₹50
 * masterclass". Returns null when no session is open, in which case the caller
 * must degrade honestly (link to the webinars index, no price claim).
 */
export function deriveMasterclass(webinars: Webinar[], now: number = Date.now()): LiveOffer | null {
  const open = webinars
    .filter((w) => isOpenWebinar(w, now) && (w.price ?? 0) > 0)
    .sort((a, b) => byStartAsc(a.datetime, b.datetime));
  const w = open[0];
  if (!w) return null;
  return {
    kind: "webinar",
    label: w.title,
    href: `/webinars/${w.slug}`,
    price: w.price,
    originalPrice: null,
    startsAt: w.datetime || null,
    seatsLeft: null,
    slug: w.slug,
  };
}

/**
 * The flagship bookable Foundation batch: featured first, then soonest batch
 * start, then display order. Returns null when nothing is bookable so the caller
 * can fall back to the `/courses` index instead of naming a closed batch.
 */
export function deriveFoundation(courses: Course[]): LiveOffer | null {
  const pool = courses.filter((c) => isBookableCourse(c) && c.category === "Foundation");
  const c = pool.sort((a, b) => {
    if (!!b.featured !== !!a.featured) return b.featured ? 1 : -1;
    const s = byStartAsc(a.batch_start, b.batch_start);
    if (s !== 0) return s;
    return (a.display_order ?? 999) - (b.display_order ?? 999);
  })[0];
  if (!c) return null;
  return {
    kind: "course",
    label: c.title,
    href: `/courses/${c.slug}`,
    price: c.price,
    originalPrice: c.original_price && c.original_price > c.price ? c.original_price : null,
    startsAt: c.batch_start || null,
    seatsLeft: seatsOf(c.capacity, c.seats_left),
    slug: c.slug,
  };
}

/**
 * Best bookable course in a category, cheapest-first. Used by the "Where are you
 * now?" selector so every recommendation is a real, open offer.
 */
export function deriveByCategory(courses: Course[], category: string): LiveOffer | null {
  const c = courses
    .filter((x) => isBookableCourse(x) && x.category === category)
    .sort((a, b) => {
      if (!!b.featured !== !!a.featured) return b.featured ? 1 : -1;
      return a.price - b.price;
    })[0];
  if (!c) return null;
  return {
    kind: "course",
    label: c.title,
    href: `/courses/${c.slug}`,
    price: c.price,
    originalPrice: c.original_price && c.original_price > c.price ? c.original_price : null,
    startsAt: c.batch_start || null,
    seatsLeft: seatsOf(c.capacity, c.seats_left),
    slug: c.slug,
  };
}

/** Is there a bookable OFFLINE (Chandigarh) batch right now? */
export function hasOfflineAdmissions(courses: Course[]): boolean {
  return courses.some(
    (c) => isBookableCourse(c) && Array.isArray(c.modes) && c.modes.some((m) => String(m).toLowerCase() === "offline"),
  );
}

export interface HeroOffers {
  masterclass: LiveOffer | null;
  foundation: LiveOffer | null;
  /** Always available — a static route, not a commercial claim. */
  quizHref: string;
}

export function deriveHeroOffers(courses: Course[], webinars: Webinar[], now: number = Date.now()): HeroOffers {
  return {
    masterclass: deriveMasterclass(webinars, now),
    foundation: deriveFoundation(courses),
    quizHref: "/quizzes",
  };
}

/** ₹ formatting in the Indian numbering system, e.g. 75000 → "₹75,000". */
export function rupees(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** Where the user says they are, expressed as an offer lookup. */
export interface RecommendationSpec {
  key: string;
  categories: string[];
  preferMasterclass?: boolean;
  offline?: boolean;
}

/**
 * Resolve each "Where are you now?" answer to a REAL, currently-bookable offer.
 *
 * Resolution order per answer:
 *   1. If the answer is best served by the masterclass and one is open, use it.
 *   2. Otherwise walk the answer's category preferences and take the first
 *      category that has a bookable course.
 *   3. If the answer is specifically about the offline Chandigarh centre and no
 *      offline batch is open, return null so the UI can say so honestly instead
 *      of recommending an online course to someone who asked for a classroom.
 *   4. Otherwise null — the UI then offers free counselling rather than guessing.
 *
 * Running this on the server keeps the selector pure client logic with no API
 * call and no AI: the client just indexes into a map that is already in the HTML
 * payload.
 */
export function deriveRecommendations(
  courses: Course[],
  webinars: Webinar[],
  specs: RecommendationSpec[],
  now: number = Date.now(),
): Record<string, LiveOffer | null> {
  const masterclass = deriveMasterclass(webinars, now);
  const offlineOpen = hasOfflineAdmissions(courses);
  const out: Record<string, LiveOffer | null> = {};

  for (const spec of specs) {
    if (spec.offline && !offlineOpen) {
      out[spec.key] = null;
      continue;
    }
    if (spec.preferMasterclass && masterclass) {
      out[spec.key] = masterclass;
      continue;
    }
    let picked: LiveOffer | null = null;
    for (const category of spec.categories) {
      picked = deriveByCategory(courses, category);
      if (picked) break;
    }
    // A cheap, genuinely-open masterclass is a better honest answer than nothing.
    out[spec.key] = picked ?? masterclass ?? null;
  }
  return out;
}
