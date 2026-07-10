/**
 * AI Counselor Agent — CONVERSATION POLICY.
 *
 * Deterministic routing + guardrail helpers shared by the guided-flow engine and
 * the widget trigger logic. Pure module (no I/O, no server imports) so it is safe
 * on both client and server.
 *
 *  - Free-text is mapped to a flow by simple keyword matching (no LLM).
 *  - Page path is mapped to a sensible default flow / greeting.
 *  - Trigger timing + frequency caps are defined here (single source of truth).
 *  - A guardrail linter (assertSafeCopy) rejects any agent copy that promises
 *    selection, uses fake scarcity, or invents offer facts — defense-in-depth so
 *    a bad edit to the copy library can be caught in tests / dev.
 */

import type { FlowId } from "./providers/types";

/* ------------------------------------------------------------------ *
 * TRIGGER TIMING & FREQUENCY (widget behaviour)
 * ------------------------------------------------------------------ */

export const TRIGGER_POLICY = {
  /** Earliest auto-open, ms after load. */
  minDelayMs: 8_000,
  /** Latest auto-open, ms after load (if scroll threshold not hit sooner). */
  maxDelayMs: 15_000,
  /** Scroll fraction (0-1) that can trigger an earlier open. */
  scrollFraction: 0.3,
  /** Suppress auto-open for this long after a manual dismiss (24h). */
  dismissSuppressMs: 24 * 60 * 60 * 1000,
  /** localStorage keys (client-only). */
  storageKeys: {
    dismissedAt: "nsa_ai_dismissed_at",
    openedSession: "nsa_ai_opened_session",
  },
} as const;

/**
 * Route prefixes where the PUBLIC widget must NEVER mount, even if the flag is on.
 * Mirrors the private boundary used by GA4 (isPublicAnalyticsPath) plus the
 * payment-internal status page which carries PII in its URL.
 */
export const WIDGET_PRIVATE_PREFIXES = [
  "/admin",
  "/dashboard",
  "/portal",
  "/login",
  "/quiz-print",
  "/payment",
] as const;

export function isWidgetAllowedPath(pathname: string | null | undefined): boolean {
  const p = (pathname || "").split("?")[0].split("#")[0];
  if (!p) return false;
  for (const pre of WIDGET_PRIVATE_PREFIXES) {
    if (p === pre || p.startsWith(`${pre}/`)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * PAGE-AWARE DEFAULT FLOW
 * ------------------------------------------------------------------ */

/**
 * Suggest a default flow based on the page the visitor is on. Returns "root"
 * (the menu) when there's no strong signal.
 */
export function flowForPath(pathname: string | null | undefined): FlowId {
  const p = (pathname || "").split("?")[0].split("#")[0].toLowerCase();
  if (!p) return "root";
  if (p.startsWith("/webinars")) return "webinar_reco";
  if (p.startsWith("/courses")) return "course_reco";
  if (p.startsWith("/resources") || p.startsWith("/current-affairs")) return "resource_conversion";
  if (p.startsWith("/quiz") || p.startsWith("/quizzes") || p.startsWith("/tests")) return "quiz_followup";
  return "root";
}

/* ------------------------------------------------------------------ *
 * FREE-TEXT KEYWORD ROUTING (deterministic, no LLM)
 * ------------------------------------------------------------------ */

const KEYWORD_ROUTES: { flow: FlowId; keywords: string[] }[] = [
  { flow: "offline_chandigarh", keywords: ["chandigarh", "offline", "classroom", "in person", "in-person", "campus", "physical class"] },
  { flow: "webinar_reco", keywords: ["webinar", "masterclass", "seminar", "free class", "live session", "workshop"] },
  { flow: "course_reco", keywords: ["course", "batch", "programme", "program", "foundation", "gs", "optional", "enrol", "enroll", "admission", "fee", "fees"] },
  { flow: "payment_recovery", keywords: ["payment", "pay", "paid", "transaction", "didn't complete", "failed", "refund", "money"] },
  { flow: "quiz_followup", keywords: ["quiz", "test", "score", "result", "mock", "practice"] },
  { flow: "resource_conversion", keywords: ["resource", "notes", "pdf", "material", "current affairs", "free study", "download"] },
  { flow: "beginner_roadmap", keywords: ["beginner", "start", "starting", "new to", "fresher", "how to prepare", "roadmap", "guidance", "begin", "first time"] },
  { flow: "counselor_handoff", keywords: ["counsel", "counsellor", "counselor", "call me", "callback", "talk to", "speak", "human", "contact", "phone"] },
];

/**
 * Map arbitrary user text to a flow. Returns "root" when nothing matches so we
 * fall back to the menu rather than guessing.
 */
export function routeText(text: string | null | undefined): FlowId {
  const t = (text || "").toLowerCase().trim();
  if (!t) return "root";
  for (const route of KEYWORD_ROUTES) {
    if (route.keywords.some((k) => t.includes(k))) return route.flow;
  }
  return "root";
}

/** Trim + hard-cap free text before it ever reaches storage / routing. */
export function sanitizeUserText(text: string | null | undefined, max = 500): string {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

/* ------------------------------------------------------------------ *
 * GUARDRAIL LINTER (self-check on our OWN copy)
 * ------------------------------------------------------------------ */

/** Patterns that must NEVER appear in agent copy (no "AI smell", no bad promises). */
const BANNED_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "selection_guarantee", re: /\b(guarantee|guaranteed|assured|100%|surely (?:clear|crack|select)|will (?:clear|crack|select|pass))\b/i },
  { name: "rank_promise", re: /\b(top rank|rank \d+|get selected|ensure selection|crack (?:it|upsc) for sure)\b/i },
  { name: "fake_scarcity", re: /\b(only \d+ seats? left|hurry|last chance|offer ends|limited time|ends tonight|few spots left|act now)\b/i },
  { name: "ai_smell", re: /\b(as an ai|i am an ai|language model|i cannot feel|i do not have feelings)\b/i },
];

export interface CopyCheckResult {
  ok: boolean;
  violations: { name: string; snippet: string }[];
}

/**
 * Check a piece of agent copy against the guardrails. Returns the violations (if
 * any). Used by tests / dev assertions — NOT a runtime filter on user text.
 */
export function checkCopy(text: string | null | undefined): CopyCheckResult {
  const s = String(text || "");
  const violations: { name: string; snippet: string }[] = [];
  for (const p of BANNED_PATTERNS) {
    const m = s.match(p.re);
    if (m) violations.push({ name: p.name, snippet: m[0] });
  }
  return { ok: violations.length === 0, violations };
}

/** Throw if copy violates the guardrails (dev/test only). */
export function assertSafeCopy(text: string): void {
  const r = checkCopy(text);
  if (!r.ok) {
    throw new Error(
      `Agent copy violates guardrails: ${r.violations.map((v) => `${v.name} ("${v.snippet}")`).join(", ")}`,
    );
  }
}
