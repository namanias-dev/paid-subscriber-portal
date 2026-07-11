/**
 * TASK: refreshOfferKnowledge
 *
 * Pull the live, public-safe offer catalog (courses + OPEN webinars) from the
 * portal — the SAME source of truth the guided-flow engine uses — and ask the
 * model to write a SHORT internal blurb summarizing what's currently on offer.
 *
 * CRITICAL: prices/dates/links are authoritative from the portal and are stored
 * VERBATIM alongside the blurb. The model text is a human-facing summary only; it
 * is never treated as fact. Stored under ai_agent_settings["ai_offer_knowledge"].
 */
import { log } from "../logger.js";
import type { Task } from "./context.js";

const SYSTEM =
  "You summarize a UPSC-coaching academy's current offerings for internal staff. " +
  "Given a list of live courses and webinars (titles + modes only), write 2-3 short " +
  "sentences describing what's on offer right now. Do NOT state or invent prices, " +
  "dates, or numbers — those are tracked separately. Plain text only.";

export const refreshOfferKnowledge: Task = async ({ portal, ollama }) => {
  const offers = await portal.getOffers();
  if (!offers) {
    log.info("refreshOfferKnowledge: could not load offers.");
    return;
  }

  // Send ONLY titles + modes to the model — never prices/dates (kept verbatim).
  const titlesOnly = {
    courses: offers.courses.map((o) => ({ title: o.title, mode: o.mode })),
    webinars: offers.webinars.map((o) => ({ title: o.title, mode: o.mode })),
  };

  const blurb = await ollama.summarize(SYSTEM, JSON.stringify(titlesOnly), 500);

  // Authoritative facts stored verbatim; the model blurb is advisory only.
  const offerKnowledge: Record<string, unknown> = {
    summary: blurb || null,
    counts: { courses: offers.courses.length, webinars: offers.webinars.length },
    offers: {
      courses: offers.courses.map((o) => ({ id: o.id, title: o.title, price: o.price, link: o.link })),
      webinars: offers.webinars.map((o) => ({ id: o.id, title: o.title, price: o.price, duration: o.duration, link: o.link })),
    },
    source: "offerResolver",
    generated_at: offers.generated_at,
  };

  const ok = await portal.postSuggestions({ offer_knowledge: offerKnowledge });
  log.info("refreshOfferKnowledge: posted offer knowledge.", {
    courses: offers.courses.length,
    webinars: offers.webinars.length,
    hasBlurb: !!blurb,
    ok,
  });
};
