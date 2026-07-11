/**
 * AI Counselor Agent — RECOMMENDATION ENGINE.
 *
 * Deterministic matching of conversation context to LIVE offers. It NEVER invents
 * an offer, a price, or a date — it only ranks and shapes what the offer resolver
 * already returned (published+active courses, OPEN webinars). If nothing fits it
 * returns null / empty so the engine can fall back to the honest "no live offer"
 * copy or a counsellor handoff.
 */

import type { LiveOffer, LiveOffers } from "./offerResolver";
import type { OfferCardData, RoadmapCardData } from "./providers/types";
import { BEGINNER, NURTURE } from "./copyLibrary";

export type StudyMode = "online" | "offline" | "either";
export type PrepStage = "fresher" | "someBasics" | "repeater";

/** Does a live offer support offline / classroom study? */
export function isOfflineOffer(o: LiveOffer): boolean {
  const hay = [o.mode || "", ...(o.best_for || [])].join(" ").toLowerCase();
  return hay.includes("offline") || hay.includes("classroom") || hay.includes("chandigarh");
}

/** Does a live offer support online study? */
export function isOnlineOffer(o: LiveOffer): boolean {
  const hay = [o.mode || "", ...(o.best_for || [])].join(" ").toLowerCase();
  // Treat "unspecified mode" as online-capable (most edtech offers are).
  if (!o.mode && (!o.best_for || o.best_for.length === 0)) return true;
  return hay.includes("online") || hay.includes("live") || hay.includes("recorded");
}

function ctaForOffer(o: LiveOffer): string {
  if (o.type === "webinar") return o.price > 0 ? "Register" : "Register free";
  return o.price > 0 ? "View & enrol" : "View course";
}

/** Shape a live offer into the safe card contract the UI renders. */
export function toOfferCard(o: LiveOffer): OfferCardData {
  return {
    type: o.type,
    id: o.id,
    slug: o.slug,
    title: o.title,
    mode: o.mode,
    price: o.price,
    duration: o.duration,
    description: o.description,
    link: o.link,
    bestFor: o.best_for || [],
    paymentEnabled: o.payment_enabled,
    seatsText: o.seats_text,
    ctaLabel: ctaForOffer(o),
  };
}

export interface CourseMatchOpts {
  mode?: StudyMode;
  stage?: PrepStage;
  /** A specific offer the visitor is already looking at (page context). */
  preferOfferId?: string | null;
  limit?: number;
}

/**
 * Rank live courses against the visitor's preferences. Returns the best matches
 * (possibly empty). Scoring is transparent and deterministic:
 *  - +3 exact page offer, +2 mode match, +1 stage keyword hit in tags/title.
 */
export function recommendCourses(offers: LiveOffers, opts: CourseMatchOpts = {}): LiveOffer[] {
  const limit = opts.limit ?? 2;
  const list = offers.courses || [];
  if (list.length === 0) return [];

  const stageKeywords: Record<PrepStage, string[]> = {
    fresher: ["foundation", "beginner", "basics", "gs foundation", "prelims"],
    someBasics: ["gs", "mains", "integrated", "comprehensive"],
    repeater: ["mains", "advanced", "answer writing", "test series", "optional"],
  };

  const scored = list.map((o) => {
    let score = 0;
    if (opts.preferOfferId && o.id === opts.preferOfferId) score += 3;
    if (opts.mode === "offline" && isOfflineOffer(o)) score += 2;
    else if (opts.mode === "online" && isOnlineOffer(o)) score += 2;
    else if (opts.mode === "either") score += 1;
    if (opts.stage) {
      const hay = [o.title, ...(o.best_for || []), o.description || ""].join(" ").toLowerCase();
      if (stageKeywords[opts.stage].some((k) => hay.includes(k))) score += 1;
    }
    return { o, score };
  });

  // If a mode was explicitly requested, drop offers that clearly don't support it.
  const filtered = scored.filter(({ o }) => {
    if (opts.mode === "offline") return isOfflineOffer(o);
    if (opts.mode === "online") return isOnlineOffer(o);
    return true;
  });

  const pool = filtered.length > 0 ? filtered : scored;
  pool.sort((a, b) => b.score - a.score);
  return pool.slice(0, limit).map((s) => s.o);
}

/** Pick the single most relevant OPEN webinar (free preferred), or null. */
export function recommendWebinar(offers: LiveOffers, preferOfferId?: string | null): LiveOffer | null {
  const list = offers.webinars || [];
  if (list.length === 0) return null;
  if (preferOfferId) {
    const exact = list.find((w) => w.id === preferOfferId);
    if (exact) return exact;
  }
  // Prefer a free webinar (lowest friction), else the first one.
  const free = list.find((w) => w.price === 0);
  return free || list[0];
}

/** All currently-open webinars as safe cards. */
export function webinarCards(offers: LiveOffers): OfferCardData[] {
  return (offers.webinars || []).map(toOfferCard);
}

/** The static beginner roadmap card (copy from the library). */
export function buildBeginnerRoadmap(): RoadmapCardData {
  return {
    title: BEGINNER.roadmapTitle,
    subtitle: BEGINNER.roadmapSubtitle,
    steps: [
      BEGINNER.steps.foundation,
      BEGINNER.steps.coreGs,
      BEGINNER.steps.answerWriting,
      BEGINNER.steps.mentorship,
    ],
  };
}

/** The static post-registration prep checklist card. */
export function buildNurtureChecklist(): RoadmapCardData {
  return {
    title: NURTURE.checklistTitle,
    subtitle: null,
    steps: [NURTURE.checklist.calendar, NURTURE.checklist.questions, NURTURE.checklist.resources],
  };
}
