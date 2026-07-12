import { TOOLS, TOOL_NAMES } from "./registry";
import type { ChatMessage } from "./types";
import type { Intent } from "./router";

/**
 * LLM provider glue — dependency-free (raw fetch), OpenAI-compatible chat-completions with
 * function-calling. Works with OpenAI directly and any OpenAI-compatible gateway (incl. the
 * Vercel AI Gateway route). The LLM's ONLY job is to PLAN which whitelisted tool to call for a
 * free-form question; answers are composed from tool output (see format.ts), so the model can
 * never invent a number. Optional short narration is grounding-checked before use.
 *
 * Configure via env (server-only): AIVA_LLM_API_KEY (or OPENAI_API_KEY), optional
 * AIVA_LLM_BASE_URL (default OpenAI), AIVA_LLM_MODEL (default gpt-4o-mini).
 */

function apiKey(): string {
  return process.env.AIVA_LLM_API_KEY || process.env.OPENAI_API_KEY || "";
}
function baseUrl(): string {
  return (process.env.AIVA_LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
}
export function llmModel(): string {
  return process.env.AIVA_LLM_MODEL || "gpt-4o-mini";
}
export function llmConfigured(): boolean {
  return Boolean(apiKey());
}
export function llmProviderName(): string {
  if (!llmConfigured()) return "none (deterministic router)";
  const base = baseUrl();
  const host = base.replace(/^https?:\/\//, "").split("/")[0];
  return `${host} · ${llmModel()}`;
}

function toolDefs() {
  return TOOL_NAMES.map((name) => {
    const spec = TOOLS[name];
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of spec.params) {
      properties[p.name] = p.enum ? { type: p.type, enum: p.enum, description: p.description } : { type: p.type, description: p.description };
      if (p.required) required.push(p.name);
    }
    return {
      type: "function",
      function: { name, description: spec.description, parameters: { type: "object", properties, required } },
    };
  });
}

const TIMEOUT_MS = 15_000;

async function chat(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const key = apiKey();
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type ChoiceMsg = { tool_calls?: { function?: { name?: string; arguments?: string } }[]; content?: string };

/**
 * Ask the model to pick ONE whitelisted tool + params for the message. Returns null on any
 * failure (caller falls back to the deterministic router). Never executes anything itself.
 */
export async function planTool(system: string, message: string, history: ChatMessage[]): Promise<Intent | null> {
  const messages = [
    { role: "system", content: system },
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];
  const json = await chat({
    model: llmModel(),
    temperature: 0,
    messages,
    tools: toolDefs(),
    tool_choice: "auto",
    max_tokens: 300,
  });
  if (!json) return null;
  const choices = json.choices as { message?: ChoiceMsg }[] | undefined;
  const msg = choices?.[0]?.message;
  const call = msg?.tool_calls?.[0]?.function;
  if (!call?.name || !TOOL_NAMES.includes(call.name)) return null;
  let args: Record<string, unknown> = {};
  try {
    args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
  } catch {
    args = {};
  }
  return { tool: call.name, args };
}

/**
 * Optional: a crisp 1–2 sentence lead, phrased by the model from the tool's own numbers. The
 * result is grounding-checked by the caller; if it fails or errors, the deterministic answer is
 * used. Returns null on failure.
 */
export async function narrate(system: string, question: string, toolJson: string): Promise<string | null> {
  const json = await chat({
    model: llmModel(),
    temperature: 0.2,
    max_tokens: 160,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `Question: ${question}\n\nTool output (JSON — the ONLY facts you may use):\n${toolJson}\n\n` +
          "Write a crisp 1–2 sentence executive lead answering the question. Use ONLY numbers present in the tool output. Do not add figures. No preamble.",
      },
    ],
  });
  if (!json) return null;
  const choices = json.choices as { message?: ChoiceMsg }[] | undefined;
  const text = choices?.[0]?.message?.content;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}
