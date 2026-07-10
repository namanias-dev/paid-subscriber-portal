/**
 * AI Counselor Agent — CONVERSATION + EVENT STORE.
 *
 * Persists agent state to the INTERNAL tables ONLY (ai_conversations,
 * ai_lead_events) via getSupabaseAdmin(). EVERYTHING written here first passes
 * through redaction (lib/ai-agent/security/redaction.ts) so no raw phone/email/
 * login code / payment ref / signature is ever stored in a summary or payload.
 *
 * This is distinct from site analytics (analytics_events / writeEvent) — that
 * pipeline is untouched. These are the agent's own internal records.
 *
 * Honors AI_AGENT_STORE_CONVERSATIONS: when false, conversation/event writes are
 * a clean no-op (returns ok:false without touching the DB).
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import { getAiAgentConfig } from "./config";
import { redactText, redactObject } from "./security/redaction";
import type { AiConversation, AiLeadEvent } from "./types";

function nowISO(): string {
  return new Date().toISOString();
}

export interface AppendTurnInput {
  sessionId: string;
  leadId?: string | null;
  /** Who spoke: 'user' | 'agent' | 'system'. */
  role: "user" | "agent" | "system";
  /** Raw message text — REDACTED before storage. */
  text?: string | null;
  /** Optional structured payload — REDACTED before storage. */
  payload?: Record<string, unknown>;
  provider?: string;
}

export interface ConversationResult {
  ok: boolean;
  conversation?: AiConversation;
  error?: string;
}

/** Fetch (or lazily create) the conversation row for a session. */
async function getOrCreateConversation(
  sessionId: string,
  leadId: string | null | undefined,
  provider: string,
): Promise<AiConversation | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;

  const { data: existing } = await db
    .from("ai_conversations")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as AiConversation;

  const ts = nowISO();
  const { data } = await db
    .from("ai_conversations")
    .insert({
      session_id: sessionId,
      lead_id: leadId ?? null,
      provider: provider || "guided_flow",
      status: "active",
      message_count: 0,
      summary: null,
      meta: {},
      started_at: ts,
      last_message_at: ts,
      created_at: ts,
    })
    .select("*")
    .maybeSingle();
  return (data as AiConversation) ?? null;
}

/**
 * Append a conversation turn: bumps message_count, updates last_message_at, keeps
 * a rolling REDACTED summary, and records a matching redacted ai_lead_events row.
 */
export async function appendTurn(input: AppendTurnInput): Promise<ConversationResult> {
  const cfg = getAiAgentConfig();
  if (!cfg.storeConversations) return { ok: false, error: "storage_disabled" };

  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "not_configured" };
  if (!input.sessionId) return { ok: false, error: "missing_session" };

  const convo = await getOrCreateConversation(
    input.sessionId,
    input.leadId,
    input.provider || cfg.provider,
  );
  if (!convo) return { ok: false, error: "convo_unavailable" };

  const ts = nowISO();
  const redactedText = redactText(input.text || "");

  // Rolling summary: keep the tail of recent redacted turns, capped in length so
  // it never grows unbounded (and never carries PII).
  const line = redactedText ? `${input.role}: ${redactedText}` : "";
  const prevSummary = convo.summary || "";
  let summary = line ? (prevSummary ? `${prevSummary}\n${line}` : line) : prevSummary;
  const MAX_SUMMARY = 4000;
  if (summary.length > MAX_SUMMARY) summary = summary.slice(summary.length - MAX_SUMMARY);

  const patch: Record<string, unknown> = {
    message_count: (convo.message_count ?? 0) + 1,
    last_message_at: ts,
    summary,
  };

  const { data: updated } = await db
    .from("ai_conversations")
    .update(patch)
    .eq("id", convo.id)
    .select("*")
    .maybeSingle();

  // Mirror as a redacted append-only event.
  await recordEvent({
    sessionId: input.sessionId,
    leadId: input.leadId ?? convo.lead_id ?? null,
    eventType: `message_${input.role}`,
    payload: { text: redactedText, ...(input.payload || {}) },
  });

  return { ok: true, conversation: (updated as AiConversation) ?? convo };
}

export interface RecordEventInput {
  sessionId?: string | null;
  leadId?: string | null;
  eventType: string;
  payload?: Record<string, unknown>;
  scoreDelta?: number;
}

export interface EventResult {
  ok: boolean;
  event?: AiLeadEvent;
  error?: string;
}

/** Append a redacted agent event to ai_lead_events. */
export async function recordEvent(input: RecordEventInput): Promise<EventResult> {
  const cfg = getAiAgentConfig();
  if (!cfg.storeConversations) return { ok: false, error: "storage_disabled" };

  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "not_configured" };

  const safePayload = redactObject(input.payload || {});
  const { data, error } = await db
    .from("ai_lead_events")
    .insert({
      session_id: input.sessionId ?? null,
      lead_id: input.leadId ?? null,
      event_type: (input.eventType || "event").slice(0, 120),
      payload: safePayload,
      score_delta: typeof input.scoreDelta === "number" ? Math.trunc(input.scoreDelta) : 0,
      created_at: nowISO(),
    })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, event: data as AiLeadEvent };
}
