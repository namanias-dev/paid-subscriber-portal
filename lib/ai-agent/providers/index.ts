/**
 * AI Counselor Agent — PROVIDER REGISTRY.
 *
 * Phase 2 ships a SINGLE provider: "guided_flow" (deterministic, no LLM). The
 * registry indirection exists so a later phase can add an LLM-backed provider
 * WITHOUT touching the API route or the widget — they only ever talk to this
 * contract. Any unknown provider name safely falls back to guided_flow.
 */

import { runGuidedFlow, type GuidedFlowDeps } from "./guidedFlow";
import type { AgentResponse, AgentTurnInput } from "./types";

export type { AgentResponse, AgentTurnInput, GuidedFlowDeps };

export interface AgentProvider {
  id: string;
  run: (input: AgentTurnInput, deps: GuidedFlowDeps) => Promise<AgentResponse>;
}

const GUIDED_FLOW: AgentProvider = {
  id: "guided_flow",
  run: runGuidedFlow,
};

const REGISTRY: Record<string, AgentProvider> = {
  guided_flow: GUIDED_FLOW,
};

/** Resolve a provider by name, falling back to the deterministic guided flow. */
export function getProvider(name: string | null | undefined): AgentProvider {
  if (!name) return GUIDED_FLOW;
  return REGISTRY[name] || GUIDED_FLOW;
}
