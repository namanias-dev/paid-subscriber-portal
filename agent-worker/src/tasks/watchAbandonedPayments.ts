/**
 * TASK: watchAbandonedPayments
 *
 * Look for leads that showed buying intent (an offer interest) but haven't
 * converted, and draft a GENTLE, non-pushy recovery suggestion for a counselor.
 *
 * The portal already owns the authoritative payment status (isPaidStatus in
 * dataProvider) — this worker never reads raw payment records. It only reasons
 * over the coarse, non-PII lead queue and posts pending suggestions for humans.
 * Nothing is auto-sent.
 */
import { log } from "../logger.js";
import type { Task } from "./context.js";
import type { MinimizedLead, SuggestionItem } from "../portalClient.js";

const SYSTEM =
  "You help UPSC-coaching counselors gently re-engage prospects who showed " +
  "interest but haven't enrolled. Given a lead's coarse non-personal signals, " +
  "suggest ONE short, respectful next step (max 30 words). No pressure tactics, " +
  "no invented prices/dates/offers, no contact details. Plain text only.";

/** Heuristic: interested (has offer_interest) but not in a converted/won state. */
function looksAbandoned(lead: MinimizedLead): boolean {
  const status = (lead.status || "").toLowerCase();
  const converted = ["converted", "won", "enrolled", "paid", "closed"].some((s) => status.includes(s));
  const hasInterest = Array.isArray(lead.offer_interest) && lead.offer_interest.length > 0;
  return hasInterest && !converted;
}

export const watchAbandonedPayments: Task = async ({ portal, ollama }) => {
  const leads = await portal.getLeads("hot_warm", 50);
  const candidates = leads.filter(looksAbandoned);
  if (!candidates.length) {
    log.info("watchAbandonedPayments: no abandoned-intent candidates.");
    return;
  }

  const suggestions: SuggestionItem[] = [];
  for (const lead of candidates) {
    const signals = JSON.stringify({
      temperature: lead.temperature,
      score: lead.score,
      status: lead.status,
      target_year: lead.target_year,
      city: lead.city,
      offer_interest: lead.offer_interest,
    });
    const draft = await ollama.summarize(SYSTEM, signals, 240);
    if (draft) suggestions.push({ lead_id: lead.id, text: `Recovery suggestion: ${draft}` });
  }

  if (!suggestions.length) {
    log.info("watchAbandonedPayments: no drafts (Ollama down?).");
    return;
  }

  const ok = await portal.postSuggestions({ suggestions });
  log.info("watchAbandonedPayments: posted recovery suggestions.", { count: suggestions.length, ok });
};
