/**
 * AI Counselor Agent — PROVIDER CONTRACT (pure, dependency-free types).
 *
 * These types are the wire contract between the guided-flow engine (server) and
 * the widget UI (client). They live in their OWN module (no server imports) so a
 * `"use client"` component can `import type` them without pulling Supabase / the
 * engine into the browser bundle.
 *
 * The whole conversation is DETERMINISTIC and quick-reply driven. A turn is:
 *   client -> { sessionId, flow, step, choiceId | text, context } -> engine
 *   engine -> { flow, step, messages[], quickReplies[], cards[], meta } -> client
 */

import type { OfferType } from "@/lib/ai-agent/offerResolver";

/** The 9 guided flows the agent supports. */
export type FlowId =
  | "root"
  | "beginner_roadmap"
  | "course_reco"
  | "webinar_reco"
  | "offline_chandigarh"
  | "quiz_followup"
  | "payment_recovery"
  | "counselor_handoff"
  | "post_registration"
  | "resource_conversion";

/**
 * A client-side action a quick reply / card button triggers, in ADDITION to (or
 * instead of) advancing the conversation. The engine only ever *describes* the
 * action; the client performs it (and fires the matching analytics event).
 */
export type AgentActionType =
  | "none"
  | "open_url" // navigate to a public site link (href)
  | "whatsapp" // open a wa.me deep link (href) — click-to-chat only
  | "tel" // open a tel: link (href)
  | "capture_lead" // reveal / submit the lead-capture form
  | "request_callback" // submit a counselor callback request
  | "register_webinar" // start the webinar registration mini-flow
  | "start_payment" // hand off to the existing course/webinar payment page
  | "dismiss"; // close the widget

/** A tappable quick-reply chip beneath the agent's message. */
export interface QuickReply {
  id: string;
  label: string;
  /** Next engine step to request when tapped (deterministic transition). */
  next?: string;
  /** Start a named flow (its entry step) when tapped. */
  flow?: FlowId;
  /** Client action to perform (default: just advance the conversation). */
  action?: AgentActionType;
  /** Public URL for open_url / whatsapp / tel actions. */
  href?: string;
  /** Analytics event name to fire on tap (PII-free). */
  track?: string;
  /** Extra PII-free props for the analytics event / next request. */
  data?: Record<string, string | number | boolean | null>;
  /** Visual emphasis. */
  kind?: "primary" | "default" | "ghost";
}

/** A live-offer card (course or webinar) rendered inside the chat. */
export interface OfferCardData {
  type: OfferType;
  id: string;
  slug: string;
  title: string;
  mode: string | null;
  price: number;
  duration: string | null;
  description: string | null;
  link: string;
  bestFor: string[];
  paymentEnabled: boolean;
  seatsText: string | null;
  /** Copy for the primary CTA (e.g. "Register free", "View & enrol"). */
  ctaLabel: string;
}

/** A structured, step-by-step roadmap card. */
export interface RoadmapCardData {
  title: string;
  subtitle?: string | null;
  steps: { title: string; detail: string }[];
}

/** A payment-abandoned recovery card. NEVER claims a seat is confirmed. */
export interface PaymentRecoveryCardData {
  itemTitle: string;
  itemType: OfferType;
  /** Human-safe status line (derived from REAL payment status, never "failed"). */
  statusLine: string;
  message: string;
  /** Where to safely resume — the existing item page / payment flow. */
  resumeLink: string | null;
  resumeLabel: string;
}

export type AgentCard =
  | { kind: "offer"; data: OfferCardData }
  | { kind: "roadmap"; data: RoadmapCardData }
  | { kind: "payment_recovery"; data: PaymentRecoveryCardData }
  | { kind: "lead_form"; data: LeadFormCardData }
  | { kind: "consent"; data: ConsentCardData };

/** Fields the lead-capture form should show (deterministic per flow). */
export interface LeadFormCardData {
  title: string;
  subtitle: string | null;
  fields: LeadFormField[];
  submitLabel: string;
  /** Which flow/step to resume after a successful capture. */
  nextStep: string;
  /** Offer this capture is about (for attribution), if any. */
  offerId?: string | null;
  offerType?: OfferType | null;
  /** Intent recorded with the lead (e.g. "callback", "webinar", "course"). */
  intent?: string | null;
}

export type LeadFormField = "name" | "phone" | "email" | "city" | "target_year";

/** Consent explainer shown before any phone capture when consent is required. */
export interface ConsentCardData {
  title: string;
  body: string;
  acceptLabel: string;
  declineLabel: string;
  /** Step to resume once consent is granted. */
  nextStep: string;
}

/** Per-turn metadata the client uses to drive UI affordances. */
export interface ResponseMeta {
  /** Marketing consent is required before the pending capture can proceed. */
  requiresConsent?: boolean;
  /** The conversation has reached a natural end (no further quick replies). */
  terminal?: boolean;
  /** A short, PII-free label describing the current intent (for analytics). */
  intent?: string | null;
  /** Lead temperature hint, when known (never PII). */
  temperature?: string | null;
}

/** A single agent chat bubble. */
export interface AgentBubble {
  id: string;
  text: string;
}

/** The full engine response for one turn. */
export interface AgentResponse {
  flow: FlowId;
  step: string;
  messages: AgentBubble[];
  quickReplies: QuickReply[];
  cards: AgentCard[];
  meta: ResponseMeta;
}

/** The request the client sends for each turn. */
export interface AgentTurnInput {
  sessionId: string;
  flow?: FlowId | null;
  step?: string | null;
  choiceId?: string | null;
  text?: string | null;
  context?: {
    pagePath?: string | null;
    offerId?: string | null;
    offerType?: OfferType | null;
  } | null;
}
