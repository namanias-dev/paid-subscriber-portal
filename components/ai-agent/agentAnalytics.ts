"use client";

/**
 * Client-side agent analytics. Phase 2 records the agent's user-facing events to
 * the agent's INTERNAL append-only store (POST /api/ai-agent/events, redacted
 * server-side). NO PII is ever sent — only a session id + PII-free props.
 *
 * Phase 4 additionally bridges these into the site-wide analytics_events pipeline
 * so AI-influenced conversions attribute alongside the rest of the funnel.
 */

/** PII-free agent event names surfaced by the widget. */
export type AgentEventName =
  | "ai_widget_opened"
  | "ai_widget_dismissed"
  | "ai_message_sent"
  | "ai_quick_reply"
  | "ai_lead_created"
  | "ai_webinar_register_click"
  | "ai_payment_start_click"
  | "ai_whatsapp_click"
  | "ai_callback_requested"
  | "ai_payment_recovery_click"
  | "ai_resource_click"
  | "ai_offer_click";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

/** Fire an agent event. Best-effort, never throws, non-blocking. */
export function trackAgentEvent(
  sessionId: string,
  eventType: AgentEventName,
  props: Record<string, string | number | boolean | null> = {},
): void {
  if (!isBrowser() || !sessionId) return;
  try {
    const payload = JSON.stringify({ session_id: sessionId, event_type: eventType, payload: props });
    const url = "/api/ai-agent/events";
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
    } else {
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}
