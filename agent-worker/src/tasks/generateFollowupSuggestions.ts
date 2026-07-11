/**
 * TASK: generateFollowupSuggestions
 *
 * For warm leads, ask the local model to draft a SHORT suggested next-step for a
 * counselor to consider (generic wording, no PII, no promises about price/dates).
 * Drafts are stored as `ai_followups` suggestions (pending). NOTHING is sent —
 * auto-send stays gated by AI_AGENT_AUTOFOLLOWUP_ENABLED on the portal, and this
 * worker has no send capability at all.
 */
import { log } from "../logger.js";
import type { Task } from "./context.js";
import type { MinimizedLead, SuggestionItem } from "../portalClient.js";

const SYSTEM =
  "You draft short internal follow-up SUGGESTIONS for UPSC-coaching counselors. " +
  "Given a lead's coarse non-personal signals, propose ONE concise next step " +
  "(max 30 words) the counselor could take. Do not address the student directly, " +
  "do not invent prices/dates/offers, and never fabricate contact details. Plain text only.";

export const generateFollowupSuggestions: Task = async ({ portal, ollama }) => {
  const leads = await portal.getLeads("warm", 25);
  if (!leads.length) {
    log.info("generateFollowupSuggestions: no warm leads.");
    return;
  }

  const suggestions: SuggestionItem[] = [];
  for (const lead of leads) {
    const signals = JSON.stringify({
      temperature: lead.temperature,
      score: lead.score,
      status: lead.status,
      target_year: lead.target_year,
      city: lead.city,
      offer_interest: lead.offer_interest,
    } satisfies Partial<MinimizedLead>);
    const draft = await ollama.summarize(SYSTEM, signals, 240);
    if (draft) suggestions.push({ lead_id: lead.id, text: `Suggested follow-up: ${draft}` });
  }

  if (!suggestions.length) {
    log.info("generateFollowupSuggestions: no drafts (Ollama down?).");
    return;
  }

  const ok = await portal.postSuggestions({ suggestions });
  log.info("generateFollowupSuggestions: posted drafts.", { count: suggestions.length, ok });
};
