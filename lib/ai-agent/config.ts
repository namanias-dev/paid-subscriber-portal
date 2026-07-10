/**
 * AI Counselor Agent — runtime configuration (Phase 1, SHIP DARK).
 *
 * All settings are read from `process.env` with SAFE DEFAULTS so the agent is a
 * clean no-op when nothing is configured. Env is read via computed access (not a
 * literal `process.env.X`) so Next.js does not inline values at build time — the
 * same pattern lib/supabase.ts uses — letting Vercel env changes take effect
 * without a rebuild.
 *
 * Phase-1 invariants encoded here:
 *  - provider defaults to 'guided_flow' (NO LLM calls in Phase 1)
 *  - the public widget is OFF by default (nothing renders publicly)
 *  - NO SMS / follow-up SENDING (auto-followup OFF; table is schema-only)
 */

function readEnv(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : undefined;
}

function readBool(key: string, fallback: boolean): boolean {
  const v = readEnv(key);
  if (v === undefined) return fallback;
  return v.toLowerCase() === "true" || v === "1";
}

function readInt(key: string, fallback: number): number {
  const v = readEnv(key);
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface AiAgentConfig {
  /** Conversation engine. Phase 1 is always 'guided_flow' (no external LLM). */
  provider: string;
  /** Master switch for any PUBLIC agent UI. Phase 1: false (ship dark). */
  publicWidget: boolean;
  /** Persist redacted conversation turns to ai_conversations/ai_lead_events. */
  storeConversations: boolean;
  /** Retention window (days) for agent data (enforced by a future cron; Phase 1 informational). */
  retentionDays: number;
  /** Auto follow-up SENDING. Phase 1: false (ai_followups is schema-only, nothing sends). */
  autoFollowupEnabled: boolean;
  /** When true, marketing-usable lead data requires marketing consent (nsa_consent). */
  requireMarketingConsent: boolean;
}

export function getAiAgentConfig(): AiAgentConfig {
  return {
    provider: readEnv("AI_AGENT_PROVIDER") || "guided_flow",
    publicWidget: readBool("AI_AGENT_PUBLIC_WIDGET", false),
    storeConversations: readBool("AI_AGENT_STORE_CONVERSATIONS", true),
    retentionDays: readInt("AI_AGENT_RETENTION_DAYS", 180),
    autoFollowupEnabled: readBool("AI_AGENT_AUTOFOLLOWUP_ENABLED", false),
    requireMarketingConsent: readBool("AI_AGENT_REQUIRE_MARKETING_CONSENT", true),
  };
}
