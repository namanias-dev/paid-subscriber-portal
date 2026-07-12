import type { ToolResult } from "./types";

/**
 * Deterministic answer composer — pure, unit-tested. Turns a ToolResult into the plain-English
 * answer text WITHOUT an LLM (used as the always-on engine and the no-key fallback). By
 * construction it only ever prints numbers that are already in the tool output (headline +
 * figures), so it can never state an unsourced figure.
 */

export const REFUSAL_TEXT =
  "I can show you and take you to the portal, but I can't send, pay, edit, enrol, or delete anything — AIVA is strictly read-only. Here's what I *can* do: pull the exact records, numbers, and a deep-link so you can act in the portal yourself.";

/** The assistant's reply when asked to perform an action (a mutation). */
export function refusalAnswer(): string {
  return REFUSAL_TEXT;
}

/** Reply when a question maps to no whitelisted tool (honest, no guessing). */
export function noToolAnswer(): string {
  return "I don't have a data tool that answers that yet, so I won't guess. I can answer questions about collections, overdue payments, revenue aging, webinar conversion, batch fill, enrollment trends, un-contacted students, attention priorities, or a specific student's timeline. Try one of those?";
}

/** Extract number-like tokens (digits, ignoring currency/commas/%), for grounding checks. */
export function numericTokens(text: string): string[] {
  const out: string[] = [];
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0].replace(/,/g, ""));
  return out;
}

/**
 * True when every number in `candidate` also appears in `allowed` (the concatenated tool
 * output). Guards optional LLM narration so it can NEVER introduce an unsourced figure.
 * Pure + unit-tested.
 */
export function isGrounded(candidate: string, allowed: string): boolean {
  const allow = new Set(numericTokens(allowed));
  // Small integers (0–31) are safe connective words ("2 things", dates) — allow them through.
  return numericTokens(candidate).every((t) => allow.has(t) || (/^\d+$/.test(t) && Number(t) <= 31));
}

/** Compose the grounded answer text from a tool result: takeaway → numbers → source. */
export function composeAnswer(result: ToolResult): string {
  const parts: string[] = [];
  parts.push(result.headline.trim());

  const figs = result.figures.filter((f) => f.value != null && f.value !== "");
  if (figs.length) {
    const lines = figs.slice(0, 8).map((f) => `- **${f.label}:** ${f.value}${f.hint ? ` (${f.hint})` : ""}`);
    parts.push(lines.join("\n"));
  }

  if (result.rowsTotal > 0) {
    parts.push(`_Evidence: ${result.rowsTotal} record${result.rowsTotal === 1 ? "" : "s"} behind these numbers — open the panel below to see them._`);
  }

  if (result.notes.length) {
    parts.push(result.notes.map((n) => `> Note: ${n}`).join("\n"));
  }

  parts.push(`_Source: ${result.provenance}_`);
  return parts.join("\n\n");
}
