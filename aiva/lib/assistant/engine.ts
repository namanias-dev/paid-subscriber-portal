import { runTool } from "./registry";
import { routeIntent, followupsFor, isActionRequest, type Intent } from "./router";
import { composeAnswer, refusalAnswer, noToolAnswer, isGrounded } from "./format";
import { systemPrompt } from "./prompt";
import { llmConfigured, planTool, narrate } from "./llm";
import type { AssistantTurn, ChatMessage, ToolResult } from "./types";

/**
 * The assistant engine. One turn = (1) refuse if it's an action request, else (2) PLAN a
 * whitelisted tool (LLM when configured, deterministic router otherwise / as fallback),
 * (3) EXECUTE the tool against real data, (4) COMPOSE the answer strictly from those results
 * (optionally with a grounding-checked LLM lead). Numbers are always sourced → never hallucinated.
 */
export async function runTurn(message: string, history: ChatMessage[] = []): Promise<AssistantTurn> {
  const msg = String(message || "").trim();

  const empty: AssistantTurn = {
    answer: "",
    tool: null,
    figures: [],
    rows: [],
    rowsTotal: 0,
    drill: null,
    links: [],
    provenance: null,
    notes: [],
    followups: followupsFor(null),
    planner: "none",
    refused: false,
  };

  if (!msg) return { ...empty, answer: noToolAnswer() };

  // 1) Refuse action/mutation requests up front.
  if (isActionRequest(msg)) {
    return { ...empty, answer: refusalAnswer(), refused: true };
  }

  // 2) Plan a tool: LLM planner (constrained to the whitelist) with deterministic fallback.
  let intent: Intent | null = null;
  let planner: AssistantTurn["planner"] = "router";
  if (llmConfigured()) {
    try {
      intent = await planTool(systemPrompt(), msg, history);
      if (intent) planner = "llm";
    } catch {
      intent = null;
    }
  }
  if (!intent) {
    intent = routeIntent(msg);
    planner = "router";
  }
  if (!intent) {
    return { ...empty, answer: noToolAnswer() };
  }

  // 3) Execute the whitelisted tool.
  let result: ToolResult;
  try {
    result = await runTool(intent.tool, intent.args);
  } catch {
    return { ...empty, answer: "Something went wrong pulling that data. Try again, or ask a different way." };
  }

  // 4) Compose strictly from the tool result.
  let answer = composeAnswer(result);
  if (llmConfigured()) {
    try {
      const allowed = [result.headline, ...result.figures.map((f) => `${f.value} ${f.hint || ""}`), ...result.notes].join(" ");
      const lead = await narrate(systemPrompt(), msg, JSON.stringify({ headline: result.headline, figures: result.figures, notes: result.notes }));
      if (lead && isGrounded(lead, allowed)) {
        answer = answer.replace(result.headline.trim(), lead.trim());
      }
    } catch {
      /* keep the deterministic answer */
    }
  }

  return {
    answer,
    tool: result.tool,
    figures: result.figures,
    rows: result.rows,
    rowsTotal: result.rowsTotal,
    drill: result.drill,
    links: result.links,
    provenance: result.provenance,
    notes: result.notes,
    followups: followupsFor(result.tool),
    planner,
    refused: false,
  };
}
