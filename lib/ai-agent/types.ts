/**
 * AI Counselor Agent — shared row types (mirror the migration tables).
 * INTERNAL agent state only; distinct from site analytics / student records.
 */
import type { Temperature } from "./leadScoring";

export interface AiLead {
  id: string;
  session_id: string | null;
  phone: string | null;
  email: string | null;
  name: string | null;
  city: string | null;
  target_year: number | null;
  source: string | null;
  campaign: string | null;
  attribution_source: string | null;
  attribution_campaign: string | null;
  attribution_fbclid: string | null;
  attribution_fbc: string | null;
  score: number;
  temperature: Temperature | string;
  status: string;
  consent_analytics: boolean;
  consent_marketing: boolean;
  offer_interest: unknown[];
  notes: string | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface AiConversation {
  id: string;
  session_id: string | null;
  lead_id: string | null;
  provider: string;
  status: string;
  message_count: number;
  summary: string | null;
  meta: Record<string, unknown>;
  started_at: string;
  last_message_at: string;
  created_at: string;
}

export interface AiLeadEvent {
  id: string;
  session_id: string | null;
  lead_id: string | null;
  event_type: string | null;
  payload: Record<string, unknown>;
  score_delta: number;
  created_at: string;
}
