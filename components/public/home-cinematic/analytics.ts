"use client";

/**
 * Analytics for the cinematic home preview.
 *
 * This is a thin typed wrapper over the EXISTING first-party beacon
 * (`trackClient` → `/api/track`). It deliberately does not introduce a second
 * transport, a second consent model, or a second identity source: identity is
 * still resolved server-side from the session cookie in the track route, and
 * these events inherit exactly the same consent treatment as every other
 * first-party event on the site.
 *
 * PII RULE: props on this page are restricted to non-identifying descriptors —
 * course/webinar slugs, tier letters, stage indices, integer prices, and the
 * selector answer key. No name, phone, email, or free text ever goes in.
 */
import { trackClient } from "@/lib/analytics/client";
import type { EventName } from "@/lib/analytics/events";

type Props = Record<string, string | number | boolean | null>;

/**
 * Emit a preview event. Wrapped so that every call site on this page shares one
 * choke point — if the preview ever needs to be muted, it is muted here.
 */
export function track(event: EventName, props: Props = {}): void {
  trackClient(event, props);
}

export const cinematic = {
  view: (tier: string) => track("cinematic_home_view", { tier }),
  modeLoaded: (tier: string, scene: string) => track("cinematic_mode_loaded", { tier, scene }),
  fallbackUsed: (reason: string, tier: string) => track("cinematic_fallback_used", { reason, tier }),

  heroMasterclass: (slug: string, price: number | null) => track("hero_masterclass_click", { slug, price }),
  heroCourse: (slug: string, price: number | null) => track("hero_course_click", { slug, price }),
  heroQuiz: () => track("hero_quiz_click", {}),

  journeyStage: (index: number, stage: string) => track("journey_stage_viewed", { index, stage }),
  selectorCompleted: (answer: string) => track("journey_selector_completed", { answer }),
  recommendationClicked: (answer: string, slug: string) => track("journey_recommendation_clicked", { answer, slug }),

  mentorCta: (href: string) => track("mentor_cta_clicked", { href }),
  courseCard: (slug: string) => track("course_card_clicked", { slug }),
  resultCard: (rank: string) => track("result_card_clicked", { rank }),
  portalShowcase: (target: string) => track("portal_showcase_clicked", { target }),
  whatsapp: (surface: string) => track("whatsapp_clicked", { surface }),
  finalCta: (slug: string) => track("final_cta_clicked", { slug }),
} as const;

const DEPTH_EVENTS: Record<number, EventName> = {
  25: "scroll_depth_25",
  50: "scroll_depth_50",
  75: "scroll_depth_75",
  100: "scroll_depth_100",
};

export function depthEvent(pct: 25 | 50 | 75 | 100): EventName {
  return DEPTH_EVENTS[pct];
}
