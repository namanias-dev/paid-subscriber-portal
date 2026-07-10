/**
 * AI Counselor Agent — LEAD SERVICE (create / update with dedupe).
 *
 * All reads/writes target the INTERNAL `ai_leads` table via getSupabaseAdmin()
 * (service role, bypasses RLS — so this module is only ever called from
 * server-side, authorization-checked code paths, never directly from a client).
 *
 * DEDUPE: a prospect is identified by PHONE first, then by SESSION_ID. We UPDATE
 * the existing lead instead of inserting a duplicate — `ai_leads` has NO unique
 * constraint (matching the site's app-level-dedupe convention), so dedupe is
 * enforced here in code.
 *
 * ABUSE GUARD: a per-phone creation cap prevents a single number spawning many
 * leads via racing requests. Score/temperature are recomputed on every write via
 * the deterministic scorer.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import { normPhone } from "@/lib/phone";
import { scoreLead, temperatureFor, type LeadSignals } from "./leadScoring";
import type { AiLead } from "./types";

const TABLE = "ai_leads";

/** Max distinct lead rows we tolerate per phone (defense against spam/races). */
const MAX_LEADS_PER_PHONE = 3;

export interface LeadUpsertInput {
  sessionId?: string | null;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  city?: string | null;
  targetYear?: number | null;
  source?: string | null;
  campaign?: string | null;
  attributionSource?: string | null;
  attributionCampaign?: string | null;
  attributionFbclid?: string | null;
  attributionFbc?: string | null;
  consentAnalytics?: boolean;
  consentMarketing?: boolean;
  /** Merged into offer_interest (deduped). */
  offerInterest?: unknown[];
  notes?: string | null;
  status?: string | null;
  /** Signals used to (re)compute score/temperature deterministically. */
  signals?: LeadSignals;
}

export interface LeadServiceResult {
  ok: boolean;
  lead?: AiLead;
  created?: boolean;
  error?: string;
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Look up an existing lead by phone (preferred) or session_id. */
export async function findLead(opts: {
  phone?: string | null;
  sessionId?: string | null;
}): Promise<AiLead | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const phone = normPhone(opts.phone || null);
  if (phone) {
    const { data } = await db
      .from(TABLE)
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) return data as AiLead;
  }
  if (opts.sessionId) {
    const { data } = await db
      .from(TABLE)
      .select("*")
      .eq("session_id", opts.sessionId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) return data as AiLead;
  }
  return null;
}

/** Count how many lead rows already exist for a phone (abuse guard). */
async function countLeadsForPhone(phone: string): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const { count } = await db
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("phone", phone);
  return count ?? 0;
}

function mergeOfferInterest(existing: unknown, incoming?: unknown[]): unknown[] {
  const base = Array.isArray(existing) ? existing : [];
  if (!incoming || incoming.length === 0) return base;
  const seen = new Set(base.map((v) => JSON.stringify(v)));
  const out = [...base];
  for (const item of incoming) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Create or update a lead with phone/session dedupe. Returns the resulting row.
 * No-ops gracefully (ok:false) when Supabase is not configured (demo mode).
 */
export async function upsertLead(input: LeadUpsertInput): Promise<LeadServiceResult> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "not_configured" };

  const phone = normPhone(input.phone || null);
  const existing = await findLead({ phone, sessionId: input.sessionId });

  // Recompute score/temperature deterministically from provided signals, folding
  // in inferred contactability so a phone/email always registers.
  const signals: LeadSignals = {
    ...(input.signals || {}),
    hasPhone: input.signals?.hasPhone ?? !!phone,
    hasEmail: input.signals?.hasEmail ?? !!input.email,
    marketingConsent: input.signals?.marketingConsent ?? !!input.consentMarketing,
  };
  const { score, temperature } = scoreLead(signals);

  const ts = nowISO();

  if (existing) {
    const patch: Record<string, unknown> = {
      last_seen_at: ts,
      updated_at: ts,
    };
    // Only overwrite with non-empty incoming values (never wipe known data).
    if (phone) patch.phone = phone;
    if (input.email) patch.email = input.email;
    if (input.name) patch.name = input.name;
    if (input.city) patch.city = input.city;
    if (typeof input.targetYear === "number") patch.target_year = input.targetYear;
    if (input.source) patch.source = input.source;
    if (input.campaign) patch.campaign = input.campaign;
    if (input.attributionSource) patch.attribution_source = input.attributionSource;
    if (input.attributionCampaign) patch.attribution_campaign = input.attributionCampaign;
    if (input.attributionFbclid) patch.attribution_fbclid = input.attributionFbclid;
    if (input.attributionFbc) patch.attribution_fbc = input.attributionFbc;
    if (typeof input.consentAnalytics === "boolean") patch.consent_analytics = input.consentAnalytics;
    if (typeof input.consentMarketing === "boolean") patch.consent_marketing = input.consentMarketing;
    if (input.notes) patch.notes = input.notes;
    if (input.status) patch.status = input.status;
    patch.offer_interest = mergeOfferInterest(existing.offer_interest, input.offerInterest);
    // Score only moves UP on update (a warmer signal never gets colder mid-journey).
    const newScore = Math.max(existing.score ?? 0, score);
    patch.score = newScore;
    patch.temperature = temperatureFor(newScore);

    const { data, error } = await db
      .from(TABLE)
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, lead: (data as AiLead) ?? existing, created: false };
  }

  // Abuse guard before creating a NEW row for a known phone.
  if (phone) {
    const existingCount = await countLeadsForPhone(phone);
    if (existingCount >= MAX_LEADS_PER_PHONE) {
      return { ok: false, error: "lead_cap_reached" };
    }
  }

  const row: Record<string, unknown> = {
    session_id: input.sessionId ?? null,
    phone: phone ?? null,
    email: input.email ?? null,
    name: input.name ?? null,
    city: input.city ?? null,
    target_year: typeof input.targetYear === "number" ? input.targetYear : null,
    source: input.source ?? null,
    campaign: input.campaign ?? null,
    attribution_source: input.attributionSource ?? null,
    attribution_campaign: input.attributionCampaign ?? null,
    attribution_fbclid: input.attributionFbclid ?? null,
    attribution_fbc: input.attributionFbc ?? null,
    score,
    temperature,
    status: input.status ?? "new",
    consent_analytics: !!input.consentAnalytics,
    consent_marketing: !!input.consentMarketing,
    offer_interest: mergeOfferInterest([], input.offerInterest),
    notes: input.notes ?? null,
    first_seen_at: ts,
    last_seen_at: ts,
    created_at: ts,
    updated_at: ts,
  };

  const { data, error } = await db.from(TABLE).insert(row).select("*").maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, lead: data as AiLead, created: true };
}
