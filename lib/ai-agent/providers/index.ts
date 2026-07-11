/**
 * AI Counselor Agent — PROVIDER REGISTRY.
 *
 * Phases 1–4 ship a SINGLE live provider: "guided_flow" (deterministic, no LLM).
 * The registry indirection exists so a later phase can add an LLM-backed provider
 * WITHOUT touching the API route or the widget — they only ever talk to this
 * contract. Any unknown provider name safely falls back to guided_flow.
 *
 * PHASE 5 (OPTIONAL) adds "ollama": a LOCAL-only wording polisher that wraps
 * guided_flow. It is only selectable when a local Ollama endpoint is configured
 * (OLLAMA_BASE_URL); otherwise selection falls back to guided_flow. Production
 * never sets that var, so the live site keeps running the deterministic engine.
 *
 * FUTURE providers (OpenAI / Gemini / Claude) can be added by:
 *   1. implementing `AgentProvider` (see the contract below),
 *   2. registering it in REGISTRY keyed by its provider id,
 *   3. adding an `isAvailable()` gate that checks its own API key/env,
 * with NO changes to the route or widget. Do NOT add paid SDK deps until then.
 */

import { runGuidedFlow, type GuidedFlowDeps } from "./guidedFlow";
import { runOllama, isOllamaConfigured } from "./ollama";
import type { AgentResponse, AgentTurnInput } from "./types";

export type { AgentResponse, AgentTurnInput, GuidedFlowDeps };

export interface AgentProvider {
  id: string;
  run: (input: AgentTurnInput, deps: GuidedFlowDeps) => Promise<AgentResponse>;
  /**
   * Optional runtime availability gate. When it returns false, `getProvider`
   * transparently falls back to guided_flow. Providers that need an API key or a
   * reachable endpoint (e.g. Ollama, and future OpenAI/Gemini/Claude) implement
   * this so a missing config can NEVER change production behaviour.
   */
  isAvailable?: () => boolean;
}

const GUIDED_FLOW: AgentProvider = {
  id: "guided_flow",
  run: runGuidedFlow,
  isAvailable: () => true,
};

/**
 * The Ollama provider is only "available" when a local endpoint is configured.
 * `runOllama` itself ALSO falls back to guided_flow internally on any error, so
 * this is defense-in-depth rather than the only guard.
 */
const OLLAMA: AgentProvider = {
  id: "ollama",
  run: runOllama,
  isAvailable: isOllamaConfigured,
};

const REGISTRY: Record<string, AgentProvider> = {
  guided_flow: GUIDED_FLOW,
  ollama: OLLAMA,
};

/**
 * Resolve a provider by name, falling back to the deterministic guided flow when
 * the name is unknown OR the named provider reports itself unavailable (e.g. no
 * OLLAMA_BASE_URL). This is what makes Phase 5 provably inert in production.
 */
export function getProvider(name: string | null | undefined): AgentProvider {
  if (!name) return GUIDED_FLOW;
  const provider = REGISTRY[name];
  if (!provider) return GUIDED_FLOW;
  if (provider.isAvailable && !provider.isAvailable()) return GUIDED_FLOW;
  return provider;
}
