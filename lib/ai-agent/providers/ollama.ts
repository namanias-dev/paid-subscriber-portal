/**
 * AI Counselor Agent — OLLAMA PROVIDER (provider = "ollama"). PHASE 5, OPTIONAL.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ABSOLUTE GUARDRAIL                                                          │
 * │  - This provider is NEVER the source of truth. It ONLY re-words the copy    │
 * │    the deterministic guided-flow engine already produced.                   │
 * │  - Offers / prices / dates / links / statuses come from guided_flow (which  │
 * │    sources them from offerResolver / server data) and are passed through    │
 * │    VERBATIM. The model only touches message *wording*.                      │
 * │  - Any error / timeout / unreachable endpoint / suspicious output → we      │
 * │    return the ORIGINAL guided_flow response with ZERO user-facing failure.  │
 * │  - Production never sets OLLAMA_BASE_URL, so this provider reports itself    │
 * │    unavailable and selection falls back to guided_flow (see index.ts).      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Flow of one turn:
 *   1. Run guided_flow → deterministic, authoritative AgentResponse (base).
 *   2. If Ollama isn't configured/available → return base untouched.
 *   3. Otherwise ask the LOCAL model (hard 8s timeout) to polish ONLY the
 *      message bubbles, returning short JSON. Validate hard; on any doubt,
 *      return base.
 */

import { runGuidedFlow, type GuidedFlowDeps } from "./guidedFlow";
import type { AgentBubble, AgentResponse, AgentTurnInput } from "./types";
import { getAiAgentLlmConfig } from "@/lib/ai-agent/config";
import { redactText } from "@/lib/ai-agent/security/redaction";

/** True when a local Ollama endpoint is configured (URL present). */
export function isOllamaConfigured(): boolean {
  return !!getAiAgentLlmConfig().ollamaBaseUrl;
}

/** Extract every digit run from a string (used to guard against invented facts). */
function digitTokens(s: string): string[] {
  return (s.match(/\d+/g) || []).map((d) => d);
}

/**
 * Validate model output against the ORIGINAL bubbles. Rejects (returns null) if
 * the model:
 *  - returned the wrong shape / empty,
 *  - produced too much text (must be a *summary*, never an expansion),
 *  - introduced ANY digit sequence that wasn't in the original copy (this is how
 *    we prevent it inventing prices / dates / phone numbers / seat counts).
 */
function acceptPolished(original: AgentBubble[], polished: unknown): string[] | null {
  if (!Array.isArray(polished) || polished.length === 0) return null;
  if (polished.length > original.length + 1) return null;

  const cleaned: string[] = [];
  for (const raw of polished) {
    if (typeof raw !== "string") return null;
    const t = raw.trim();
    if (!t) continue;
    if (t.length > 400) return null;
    cleaned.push(t);
  }
  if (cleaned.length === 0) return null;

  const originalText = original.map((b) => b.text).join(" ");
  const polishedText = cleaned.join(" ");

  // Length guard: a polish must not balloon the copy.
  if (polishedText.length > originalText.length * 1.5 + 120) return null;

  // Fact guard: no NEW numbers may appear. (Numbers present in the source may be
  // reordered/kept, but the model may not conjure a price/date/count.)
  const allowed = new Set(digitTokens(originalText));
  for (const tok of digitTokens(polishedText)) {
    if (!allowed.has(tok)) return null;
  }
  return cleaned;
}

/**
 * Minimized, NON-PII hint passed to the model to guide tone. We deliberately
 * send only coarse, safe signals — never phone/email/name/free text. Even the
 * step/intent are low-cardinality labels.
 */
function minimizedHint(input: AgentTurnInput, base: AgentResponse): string {
  const parts = [
    `flow=${base.flow}`,
    base.meta?.intent ? `intent=${base.meta.intent}` : null,
    base.meta?.temperature ? `temperature=${base.meta.temperature}` : null,
    input.context?.offerType ? `offer_type=${input.context.offerType}` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

interface OllamaCallArgs {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  original: AgentBubble[];
  hint: string;
}

/**
 * Call the local Ollama /api/chat once, with a HARD abort timeout. Returns the
 * validated polished bubbles, or null on ANY problem (network, non-200, bad
 * JSON, validation failure). This function NEVER throws.
 */
async function callOllama(args: OllamaCallArgs): Promise<string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    // Redact defensively — the copy is agency-authored, but this guarantees no
    // PII could ever reach the model even if a future flow embeds it.
    const bubbles = args.original.map((b) => redactText(b.text));
    const system =
      "You are a copy editor for an Indian UPSC coaching website's chat assistant. " +
      "Rewrite the given assistant message bubbles to be warmer, clearer and concise. " +
      "STRICT RULES: keep the SAME meaning; do NOT add or change any numbers, prices, " +
      "dates, links or facts; do NOT invent offers; do NOT add new information; return " +
      "AT MOST the same number of bubbles; keep each bubble short. Respond ONLY with " +
      'JSON of the form {"messages":["...","..."]}.';
    const user = JSON.stringify({ context: args.hint, messages: bubbles });

    const res = await fetch(`${args.baseUrl.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: args.model,
        stream: false,
        format: "json",
        options: { temperature: 0.4, num_predict: 400 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data?.message?.content;
    if (!content || typeof content !== "string") return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
    const messages = (parsed as { messages?: unknown })?.messages;
    return acceptPolished(args.original, messages);
  } catch {
    // AbortError (timeout), network refused (localhost unreachable), etc.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one turn via the Ollama provider. ALWAYS produces a valid AgentResponse:
 * the deterministic guided-flow response is authoritative and is returned as-is
 * whenever the model is absent, slow, unreachable, or returns anything we can't
 * fully trust.
 */
export async function runOllama(
  input: AgentTurnInput,
  deps: GuidedFlowDeps,
): Promise<AgentResponse> {
  // 1) Deterministic source of truth (offers/prices/links live here).
  const base = await runGuidedFlow(input, deps);

  const cfg = getAiAgentLlmConfig();
  // 2) No local model configured → guided_flow, untouched.
  if (!cfg.ollamaBaseUrl) return base;
  // Nothing to polish (e.g. a card-only turn) → return base.
  if (!base.messages.length) return base;

  // 3) Best-effort polish, guarded by an 8s hard timeout + strict validation.
  const polished = await callOllama({
    baseUrl: cfg.ollamaBaseUrl,
    model: cfg.ollamaModel,
    timeoutMs: cfg.ollamaTimeoutMs,
    original: base.messages,
    hint: minimizedHint(input, base),
  });
  if (!polished) return base;

  // Re-word ONLY the message bubbles. quickReplies, cards (offer facts), meta,
  // flow and step are passed through verbatim from the deterministic engine.
  return {
    ...base,
    messages: polished.map((text, i) => ({
      id: base.messages[i]?.id || `p${i}`,
      text,
    })),
  };
}
