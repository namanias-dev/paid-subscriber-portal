import { getSupabase } from "../supabase";
import { maskPhone, maskEmail } from "../mask";
import type { ActorType, BusinessEventType } from "./catalog";

/**
 * Idempotent writer for the canonical `business_events` table. Best-effort — never throws into a
 * caller's hot path. Deduplicates by `idempotency_key` (unique index); a duplicate is a silent
 * no-op that returns false. PII in payloads is masked before storage.
 */

export type EmitInput = {
  event_type: BusinessEventType;
  actor_type?: ActorType;
  actor_id?: string | null;
  anonymous_session_id?: string | null;
  student_id?: string | null;
  lead_id?: string | null;
  enrollment_id?: string | null;
  payment_id?: string | null;
  course_id?: string | null;
  webinar_id?: string | null;
  campaign_id?: string | null;
  source?: string | null;
  payload?: Record<string, unknown>;
  occurred_at?: string;
  idempotency_key: string;
  schema_version?: number;
};

const PII_KEYS = new Set(["phone", "mobile", "email", "login_code", "access_code", "password"]);

function sanitize(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    const lk = k.toLowerCase();
    if (lk.includes("password") || lk.includes("secret") || lk.includes("token") || lk === "login_code" || lk === "access_code") {
      continue; // never store secrets
    }
    if ((lk.includes("phone") || lk === "mobile") && typeof v === "string") out[k] = maskPhone(v);
    else if (lk.includes("email") && typeof v === "string") out[k] = maskEmail(v);
    else if (PII_KEYS.has(lk) && typeof v === "string") out[k] = maskPhone(v);
    else out[k] = v;
  }
  return out;
}

export async function emit(input: EmitInput): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb.from("business_events").insert({
      event_type: input.event_type,
      actor_type: input.actor_type || "system",
      actor_id: input.actor_id ?? null,
      anonymous_session_id: input.anonymous_session_id ?? null,
      student_id: input.student_id ?? null,
      lead_id: input.lead_id ?? null,
      enrollment_id: input.enrollment_id ?? null,
      payment_id: input.payment_id ?? null,
      course_id: input.course_id ?? null,
      webinar_id: input.webinar_id ?? null,
      campaign_id: input.campaign_id ?? null,
      source: input.source ?? "aiva",
      payload_json: sanitize(input.payload),
      occurred_at: input.occurred_at || new Date().toISOString(),
      idempotency_key: input.idempotency_key,
      schema_version: input.schema_version ?? 1,
    });
    // Unique-violation on idempotency_key => already recorded => treat as success no-op.
    if (error && !String(error.code || "").startsWith("23")) return false;
    return !error;
  } catch {
    return false;
  }
}
