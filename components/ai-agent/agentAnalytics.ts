"use client";

/**
 * Client-side agent analytics.
 *
 * Reuses the SITE-WIDE first-party analytics pipeline (trackClient → /api/track →
 * analytics_events): no parallel table, session/visitor ids + attribution
 * (nsa_attr) are resolved by the shared client helper / server route, and NO PII
 * is ever sent (event names + PII-free props only). This is what lets
 * AI-influenced registrations/payments attribute alongside the rest of the funnel
 * (by phone/visitor, via the same registration_created / payment events).
 *
 * The agent's own conversation turns are stored separately (internal
 * ai_conversations / ai_lead_events) by the message API — that is distinct from
 * these user-facing analytics events.
 */
import { trackClient } from "@/lib/analytics/client";
import type { EventName } from "@/lib/analytics/events";

/** PII-free agent event names (a subset of the shared EventName union). */
export type AgentEventName = Extract<EventName, `ai_${string}`>;

/**
 * Fire an agent analytics event through the shared pipeline. `sessionId` is kept
 * for call-site clarity but identity/session/attribution are resolved from the
 * first-party cookies server-side — never trusted from here.
 */
export function trackAgentEvent(
  _sessionId: string,
  eventType: AgentEventName,
  props: Record<string, string | number | boolean | null> = {},
): void {
  trackClient(eventType, props);
}
