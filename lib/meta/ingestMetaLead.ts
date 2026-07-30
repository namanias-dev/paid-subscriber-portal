/**
 * Idempotent Meta Lead Ad → CRM ingest.
 *
 * Collision policy: if normalised phone already has an active lead, ATTACH a
 * Meta touch (sources history + meta_* fields) without changing status or
 * overwriting an existing source. New phones get source="Meta Ads".
 *
 * pending_retry / retryable failed rows are UPDATED on Meta retry (UNIQUE
 * leadgen_id must not block recovery). Terminal outcomes short-circuit.
 */

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../supabase";
import { normalizeIndianMobile, normPhone } from "../phone";
import { DEFAULT_LEAD_STATUS } from "../leadStatus";
import { findActiveLeadByPhone, updateLead, addLead } from "../dataProvider";
import { scheduleBehaviourStatusApply } from "../leadBehaviourStatus";
import { phoneKeyFromRaw } from "../marketing/legacyLeadMatch";
import {
  fetchLeadgenRecord,
  type CapturedMetaLead,
  type MetaLeadgenPayload,
} from "./leadAds";
import type { Lead, LeadSourceTouch } from "../types";

export type MetaIngestOutcome =
  | "created"
  | "attached_existing"
  | "duplicate"
  | "failed"
  | "pending_retry";

export interface MetaIngestResult {
  outcome: MetaIngestOutcome;
  leadId: string | null;
  leadgenId: string;
  error?: string;
  handlerMs: number;
}

const META_SOURCE = "Meta Ads";

const TERMINAL_OUTCOMES = new Set(["created", "attached_existing", "duplicate"]);

function uuid(): string {
  return randomUUID();
}

interface IngestionRow {
  id: string;
  leadgen_id: string;
  outcome: string;
  lead_id: string | null;
}

async function getIngestion(leadgenId: string): Promise<IngestionRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db
    .from("meta_lead_ingestions")
    .select("id,leadgen_id,outcome,lead_id")
    .eq("leadgen_id", leadgenId)
    .maybeSingle();
  return (data as IngestionRow | null) ?? null;
}

async function upsertIngestion(
  row: Record<string, unknown>,
  existingId: string | null,
): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Database unavailable");
  if (existingId) {
    const { id: _drop, leadgen_id: _lg, ...patch } = row;
    void _drop;
    void _lg;
    const { error } = await db.from("meta_lead_ingestions").update(patch).eq("id", existingId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await db.from("meta_lead_ingestions").insert(row);
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return;
    throw new Error(error.message);
  }
}

async function attachToExisting(
  existing: Lead,
  captured: CapturedMetaLead,
  phoneDigits: string,
): Promise<Lead> {
  const now = new Date().toISOString();
  const history: LeadSourceTouch[] = Array.isArray(existing.sources)
    ? [...existing.sources]
    : [{ source: existing.source, campaign: existing.campaign, at: existing.created_at }];
  history.push({
    source: META_SOURCE,
    campaign: captured.campaign_name || null,
    at: captured.meta_created_at || now,
  });

  const patch: Partial<Lead> & Record<string, unknown> = {
    sources: history,
    updated_at: now,
    // NEVER overwrite status. NEVER overwrite an existing source.
    first_source: existing.first_source || existing.source || META_SOURCE,
    first_campaign: existing.first_campaign ?? existing.campaign ?? captured.campaign_name ?? null,
  };
  if (!existing.campaign && captured.campaign_name) patch.campaign = captured.campaign_name;
  if ((!existing.name || existing.name === "New Lead") && captured.fields.full_name) {
    patch.name = captured.fields.full_name;
  }
  if (!existing.email && captured.fields.email) patch.email = captured.fields.email;
  if (!existing.city && captured.fields.city) patch.city = captured.fields.city;
  if (!(existing as { meta_leadgen_id?: string | null }).meta_leadgen_id) {
    patch.meta_leadgen_id = captured.leadgen_id;
  }
  patch.meta_ingested_at = now;

  const updated = await updateLead(existing.id, patch as Partial<Lead>);
  void phoneDigits;
  return updated || ({ ...existing, ...patch } as Lead);
}

async function createNewLead(captured: CapturedMetaLead, phoneDigits: string): Promise<Lead> {
  // Re-check: race with another writer → attach, never clobber source/status.
  const raced = await findActiveLeadByPhone(phoneDigits);
  if (raced) return attachToExisting(raced, captured, phoneDigits);

  const lead = await addLead(
    {
      name: captured.fields.full_name || "Meta Lead",
      phone: phoneDigits,
      email: captured.fields.email,
      city: captured.fields.city,
      source: META_SOURCE,
      campaign: captured.campaign_name || null,
      status: DEFAULT_LEAD_STATUS,
      channel: META_SOURCE,
    },
    "meta_lead_ad",
  );

  // If addLead folded (tiny race), restore prior source — never last-touch Meta over existing.
  if (lead.first_source && lead.first_source !== META_SOURCE && lead.source === META_SOURCE) {
    return attachToExisting(
      { ...lead, source: lead.first_source },
      captured,
      phoneDigits,
    );
  }

  const now = new Date().toISOString();
  const patched = await updateLead(lead.id, {
    created_at: captured.meta_created_at || lead.created_at,
    meta_leadgen_id: captured.leadgen_id,
    meta_ingested_at: now,
    campaign: captured.campaign_name || lead.campaign,
    channel: lead.channel || META_SOURCE,
  } as Partial<Lead>);
  return patched || lead;
}

function ingestionBase(
  captured: CapturedMetaLead | null,
  payload: MetaLeadgenPayload,
  opts: {
    outcome: MetaIngestOutcome;
    leadId: string | null;
    error?: string;
    handlerMs: number;
    signatureValid: boolean;
    rawWebhook: unknown;
    phoneKey: string | null;
    noUsableContact: boolean;
  },
): Record<string, unknown> {
  return {
    id: uuid(),
    leadgen_id: payload.leadgen_id,
    lead_id: opts.leadId,
    page_id: payload.page_id,
    form_id: payload.form_id,
    form_name: captured?.form_name ?? null,
    ad_id: captured?.ad_id ?? payload.ad_id ?? null,
    adset_id: captured?.adset_id ?? payload.adgroup_id ?? null,
    campaign_id: captured?.campaign_id ?? payload.campaign_id ?? null,
    campaign_name: captured?.campaign_name ?? null,
    platform: captured?.platform ?? null,
    meta_created_at: captured?.meta_created_at ?? null,
    outcome: opts.outcome,
    error_message: opts.error ?? null,
    handler_ms: opts.handlerMs,
    signature_valid: opts.signatureValid,
    raw_webhook: opts.rawWebhook ?? null,
    raw_lead: captured?.raw_lead ?? null,
    field_data: captured?.fields.raw_field_data ?? null,
    phone_key: opts.phoneKey,
    no_usable_contact: opts.noUsableContact,
    ingested_at: new Date().toISOString(),
  };
}

/**
 * Ingest one Meta leadgen notification. Safe to call repeatedly for the same
 * leadgen_id (returns duplicate for terminal outcomes).
 */
export async function ingestMetaLeadFromWebhook(
  payload: MetaLeadgenPayload,
  opts: {
    rawWebhook: unknown;
    signatureValid: boolean;
    startedAt: number;
  },
): Promise<MetaIngestResult> {
  const leadgenId = payload.leadgen_id;
  const handlerMs = () => Date.now() - opts.startedAt;

  const prior = await getIngestion(leadgenId);
  if (prior && TERMINAL_OUTCOMES.has(prior.outcome)) {
    return {
      outcome: "duplicate",
      leadId: prior.lead_id,
      leadgenId,
      handlerMs: handlerMs(),
    };
  }
  // Terminal failed (e.g. no phone) → ACK as duplicate so Meta stops retrying.
  if (prior && prior.outcome === "failed") {
    return {
      outcome: "duplicate",
      leadId: prior.lead_id,
      leadgenId,
      handlerMs: handlerMs(),
    };
  }
  const upsertId = prior?.outcome === "pending_retry" ? prior.id : null;

  let captured: CapturedMetaLead;
  try {
    captured = await fetchLeadgenRecord(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      await upsertIngestion(
        ingestionBase(null, payload, {
          outcome: "pending_retry",
          leadId: null,
          error: message.slice(0, 500),
          handlerMs: handlerMs(),
          signatureValid: opts.signatureValid,
          rawWebhook: opts.rawWebhook,
          phoneKey: null,
          noUsableContact: false,
        }),
        upsertId,
      );
    } catch {
      /* best-effort */
    }
    return { outcome: "pending_retry", leadId: null, leadgenId, error: message, handlerMs: handlerMs() };
  }

  const phoneRaw = captured.fields.phone_number;
  const norm = normalizeIndianMobile(phoneRaw || "");
  const phoneDigits = norm.ok && norm.digits10 ? norm.digits10 : normPhone(phoneRaw) || "";
  const phoneKey = phoneKeyFromRaw(phoneDigits) || (phoneDigits.length === 10 ? phoneDigits : "");

  if (!phoneKey) {
    await upsertIngestion(
      ingestionBase(captured, payload, {
        outcome: "failed",
        leadId: null,
        error: "No usable 10-digit Indian phone",
        handlerMs: handlerMs(),
        signatureValid: opts.signatureValid,
        rawWebhook: opts.rawWebhook,
        phoneKey: null,
        noUsableContact: true,
      }),
      upsertId,
    );
    return {
      outcome: "failed",
      leadId: null,
      leadgenId,
      error: "No usable 10-digit Indian phone",
      handlerMs: handlerMs(),
    };
  }

  try {
    let lead: Lead;
    let outcome: MetaIngestOutcome;

    const existing = await findActiveLeadByPhone(phoneKey);
    if (existing) {
      lead = await attachToExisting(existing, captured, phoneKey);
      outcome = "attached_existing";
    } else {
      lead = await createNewLead(captured, phoneKey);
      outcome = "created";
    }
    scheduleBehaviourStatusApply(phoneKey);

    await upsertIngestion(
      ingestionBase(captured, payload, {
        outcome,
        leadId: lead.id,
        handlerMs: handlerMs(),
        signatureValid: opts.signatureValid,
        rawWebhook: opts.rawWebhook,
        phoneKey,
        noUsableContact: false,
      }),
      upsertId,
    );

    return { outcome, leadId: lead.id, leadgenId, handlerMs: handlerMs() };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      await upsertIngestion(
        ingestionBase(captured, payload, {
          outcome: "failed",
          leadId: null,
          error: message.slice(0, 500),
          handlerMs: handlerMs(),
          signatureValid: opts.signatureValid,
          rawWebhook: opts.rawWebhook,
          phoneKey: phoneKey || null,
          noUsableContact: false,
        }),
        upsertId,
      );
    } catch {
      /* ignore */
    }
    return { outcome: "failed", leadId: null, leadgenId, error: message, handlerMs: handlerMs() };
  }
}

/** Build a MetaLeadgenPayload + ingest from a Graph lead row (historical/reconcile). */
export async function ingestCapturedGraphLead(
  pageId: string,
  graphLead: Record<string, unknown>,
  rawWebhook: unknown = null,
): Promise<MetaIngestResult> {
  const id = String(graphLead.id || "");
  if (!id) {
    return { outcome: "failed", leadId: null, leadgenId: "", error: "missing id", handlerMs: 0 };
  }
  const created = graphLead.created_time;
  const createdUnix =
    typeof created === "string"
      ? Math.floor(new Date(created).getTime() / 1000)
      : typeof created === "number"
        ? created
        : 0;
  const payload: MetaLeadgenPayload = {
    leadgen_id: id,
    page_id: pageId,
    form_id: String(graphLead.form_id || ""),
    created_time: createdUnix,
    ad_id: typeof graphLead.ad_id === "string" ? graphLead.ad_id : undefined,
    adgroup_id: typeof graphLead.adset_id === "string" ? graphLead.adset_id : undefined,
    campaign_id: typeof graphLead.campaign_id === "string" ? graphLead.campaign_id : undefined,
  };
  return ingestMetaLeadFromWebhook(payload, {
    rawWebhook,
    signatureValid: true,
    startedAt: Date.now(),
  });
}

/** Retry all pending_retry rows (admin / reconcile). */
export async function retryPendingMetaIngestions(limit = 50): Promise<{
  attempted: number;
  results: MetaIngestResult[];
}> {
  const db = getSupabaseAdmin();
  if (!db) return { attempted: 0, results: [] };
  const { data } = await db
    .from("meta_lead_ingestions")
    .select("leadgen_id,page_id,form_id,ad_id,adset_id,campaign_id,meta_created_at,raw_webhook")
    .eq("outcome", "pending_retry")
    .order("ingested_at", { ascending: true })
    .limit(limit);
  const results: MetaIngestResult[] = [];
  for (const row of data || []) {
    const metaCreated = row.meta_created_at
      ? Math.floor(new Date(row.meta_created_at).getTime() / 1000)
      : 0;
    const r = await ingestMetaLeadFromWebhook(
      {
        leadgen_id: row.leadgen_id,
        page_id: row.page_id || "",
        form_id: row.form_id || "",
        created_time: metaCreated,
        ad_id: row.ad_id || undefined,
        adgroup_id: row.adset_id || undefined,
        campaign_id: row.campaign_id || undefined,
      },
      {
        rawWebhook: row.raw_webhook,
        signatureValid: true,
        startedAt: Date.now(),
      },
    );
    results.push(r);
  }
  return { attempted: results.length, results };
}

export { META_SOURCE };
