/**
 * TASK: summarizeHotLeads
 *
 * Pull the minimized (NON-PII) hot/warm lead queue from the portal and ask the
 * local model to write a SHORT, one-line prioritization note per lead (e.g.
 * "high intent — repeat visitor interested in a foundation course"). Notes are
 * posted back as `ai_followups` suggestions (pending, never sent) keyed by the
 * lead id, so a human counselor can act on them.
 *
 * The model only ever sees coarse signals (temperature, score, target year,
 * city category, offer interest) — never phone/email/name.
 */
import { log } from "../logger.js";
import type { Task } from "./context.js";
import type { MinimizedLead, SuggestionItem } from "../portalClient.js";

const SYSTEM =
  "You are an assistant to UPSC-coaching counselors. Given ONE lead's coarse, " +
  "non-personal signals, write a SINGLE short sentence (max 25 words) advising " +
  "the counselor how to prioritize/approach them. Do NOT invent facts, names, " +
  "prices or contact details. Output plain text only.";

function leadSignals(lead: MinimizedLead): string {
  return JSON.stringify({
    temperature: lead.temperature,
    score: lead.score,
    status: lead.status,
    target_year: lead.target_year,
    city: lead.city,
    offer_interest: lead.offer_interest,
  });
}

export const summarizeHotLeads: Task = async ({ portal, ollama }) => {
  const leads = await portal.getLeads("hot_warm", 25);
  if (!leads.length) {
    log.info("summarizeHotLeads: no hot/warm leads.");
    return;
  }

  const suggestions: SuggestionItem[] = [];
  for (const lead of leads) {
    const note = await ollama.summarize(SYSTEM, leadSignals(lead), 200);
    if (note) suggestions.push({ lead_id: lead.id, text: `Priority note: ${note}` });
  }

  if (!suggestions.length) {
    log.info("summarizeHotLeads: model produced no usable notes (Ollama down?).");
    return;
  }

  const ok = await portal.postSuggestions({ suggestions });
  log.info("summarizeHotLeads: posted suggestions.", { count: suggestions.length, ok });
};
