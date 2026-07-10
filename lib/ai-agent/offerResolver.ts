/**
 * AI Counselor Agent — LIVE OFFER RESOLVER.
 *
 * Single source of truth for what the agent is allowed to talk about / recommend.
 * It returns ONLY offers that a real prospect could actually buy/book RIGHT NOW,
 * reusing the SAME production rules the public site uses:
 *
 *   - Courses : getPublishedCourses() already filters status==='published' &&
 *               active!==false (see lib/dataProvider.ts). We surface those as-is.
 *   - Webinars: getPublicWebinars() INCLUDES past/completed events, so we re-filter
 *               through lib/webinarLifecycle.ts and keep ONLY effectiveRegStatus()
 *               === 'OPEN'. A non-OPEN webinar is NEVER surfaced.
 *
 * PRICE is always SERVER-sourced (from the DB row) — callers must never trust a
 * client-supplied price. All admin/PII/internal fields are STRIPPED; only the
 * safe, public-facing subset below is returned.
 *
 * Caching: a short in-memory TTL (default 45s) reduces DB churn under chat load,
 * but we never cache a stale "OPEN" long enough to matter — webinar bookability is
 * re-derived from the row's timestamps on every read anyway, and the TTL is well
 * under the granularity of a registration cutoff. Public API routes stay
 * force-dynamic; this cache is per-server-instance and best-effort only.
 */

import { getPublishedCourses, getPublicWebinars } from "@/lib/dataProvider";
import { effectiveRegStatus } from "@/lib/webinarLifecycle";
import type { Course, Webinar } from "@/lib/types";

export type OfferType = "course" | "webinar";

/** PUBLIC-SAFE offer shape. NO admin/internal/PII fields ever appear here. */
export interface LiveOffer {
  type: OfferType;
  id: string;
  slug: string;
  title: string;
  /** Learning mode(s) / session type, e.g. "Online", "Offline", "Live", "Recorded". */
  mode: string | null;
  /** SERVER-sourced price in INR (0 = free). Never accept a client price. */
  price: number;
  /** Human-readable duration (courses) or session date/time (webinars). */
  duration: string | null;
  /** Short plain-text description (sanitized / truncated). */
  description: string | null;
  /** Public link on the marketing site. */
  link: string;
  /** Derived audience tags (best-effort; safe, non-PII). */
  best_for: string[];
  /** Whether a registration/payment flow is currently enabled for this offer. */
  registration_enabled: boolean;
  payment_enabled: boolean;
  /** Optional seats-display text if the offer exposes one publicly. */
  seats_text: string | null;
}

export interface LiveOffers {
  courses: LiveOffer[];
  webinars: LiveOffer[];
  generated_at: string;
}

const CACHE_TTL_MS = 45_000;
let cache: { data: LiveOffers; expires: number } | null = null;

/** Strip HTML tags + collapse whitespace, then truncate to a safe length. */
function shortText(s: string | null | undefined, max = 240): string | null {
  if (!s) return null;
  const clean = String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}\u2026` : clean;
}

/** Best-effort seats-display text WITHOUT leaking exact internal counts. */
function courseSeatsText(c: Course): string | null {
  const cfg = c.seat_config;
  // Respect a public seat display only if the course exposes one.
  if (cfg && typeof cfg === "object") {
    const anyCfg = cfg as Record<string, unknown>;
    if (anyCfg.show === false) return null;
  }
  if (typeof c.seats_left === "number" && c.seats_left > 0 && c.seats_left <= 20) {
    return `Only ${c.seats_left} seats left`;
  }
  return null;
}

function courseBestFor(c: Course): string[] {
  const tags: string[] = [];
  if (c.category) tags.push(String(c.category));
  if (c.target_years) tags.push(`Target ${c.target_years}`);
  for (const m of c.modes || []) tags.push(String(m));
  return Array.from(new Set(tags)).slice(0, 6);
}

function courseToOffer(c: Course): LiveOffer {
  return {
    type: "course",
    id: c.id,
    slug: c.slug,
    title: c.title,
    mode: (c.modes && c.modes.length ? c.modes.join(" / ") : null),
    price: typeof c.price === "number" ? c.price : 0,
    duration: c.duration || c.batch_start || null,
    description: shortText(c.description || c.long_description || null),
    link: `/courses/${c.slug}`,
    best_for: courseBestFor(c),
    registration_enabled: true,
    payment_enabled: (typeof c.price === "number" ? c.price : 0) > 0,
    seats_text: courseSeatsText(c),
  };
}

function webinarWhen(w: Webinar): string | null {
  if (!w.datetime) return null;
  const t = Date.parse(w.datetime);
  if (Number.isNaN(t)) return null;
  // Render in IST for a natural, India-facing string.
  try {
    return new Date(t).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return w.datetime;
  }
}

function webinarToOffer(w: Webinar): LiveOffer {
  const price = typeof w.price === "number" ? w.price : 0;
  return {
    type: "webinar",
    id: w.id,
    slug: w.slug,
    title: w.title,
    mode: w.session_type === "recorded" ? "Recorded" : "Live",
    price,
    duration: webinarWhen(w),
    description: shortText(w.description || w.long_description || null),
    link: `/webinars/${w.slug}`,
    best_for: [],
    registration_enabled: true,
    payment_enabled: price > 0,
    seats_text: null,
  };
}

/**
 * Return the live, bookable offer catalog for the agent. Cached in-memory for a
 * short TTL; pass `force` to bypass the cache.
 */
export async function getLiveOffers(force = false): Promise<LiveOffers> {
  const now = Date.now();
  if (!force && cache && cache.expires > now) return cache.data;

  const [rawCourses, rawWebinars] = await Promise.all([
    getPublishedCourses().catch(() => [] as Course[]),
    getPublicWebinars().catch(() => [] as Webinar[]),
  ]);

  // getPublishedCourses already enforces published && active!==false.
  const courses = rawCourses.map(courseToOffer);

  // getPublicWebinars INCLUDES past/completed — keep only currently OPEN ones.
  const webinars = rawWebinars
    .filter((w) => effectiveRegStatus(w) === "OPEN")
    .map(webinarToOffer);

  const data: LiveOffers = {
    courses,
    webinars,
    generated_at: new Date(now).toISOString(),
  };
  cache = { data, expires: now + CACHE_TTL_MS };
  return data;
}

/** Flat list of all live offers (courses + webinars). */
export async function getAllLiveOffers(force = false): Promise<LiveOffer[]> {
  const { courses, webinars } = await getLiveOffers(force);
  return [...courses, ...webinars];
}

/**
 * Validate that an offer id/type is a REAL, currently-bookable offer. Returns the
 * safe offer or null. Public APIs MUST use this to reject unknown/inactive ids
 * (and to source the authoritative price) rather than trusting the client.
 */
export async function resolveLiveOffer(
  offerId: string,
  offerType?: OfferType,
): Promise<LiveOffer | null> {
  if (!offerId) return null;
  const all = await getAllLiveOffers();
  return (
    all.find((o) => o.id === offerId && (!offerType || o.type === offerType)) || null
  );
}

/** Test/maintenance hook: clear the in-memory cache. */
export function _clearOfferCache(): void {
  cache = null;
}
