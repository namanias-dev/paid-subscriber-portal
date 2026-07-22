/**
 * Phase 2C — Meta Lead Ads Graph API client (SCAFFOLD).
 *
 * Not wired to any live endpoint. The webhook handler at
 * /api/meta/leadgen-webhook forwards the signed leadgen payload here, and this
 * module is where the Graph API fetch of the actual lead row would happen.
 *
 * All functions throw MetaLeadsNotConfiguredError until an operator supplies:
 *   - META_APP_ID
 *   - META_APP_SECRET
 *   - META_LEADGEN_VERIFY_TOKEN
 *   - META_LONG_LIVED_TOKEN  (page-scoped, refreshed every ~60 days)
 * AND flips META_LEADS_ENABLED=true.
 *
 * A live implementation is INTENTIONALLY not shipped — writing a live path with
 * an unset token is worse than a 501, because the app looks configured but
 * silently drops leads.
 */

import { isMetaLeadsEnabled } from "../legacy-migration/flags";

/** Thrown when a Graph API call is attempted while the flag / secrets are absent. */
export class MetaLeadsNotConfiguredError extends Error {
  constructor(readonly missing: string[]) {
    super(`Meta Lead Ads is not configured. Missing: ${missing.join(", ")}`);
    this.name = "MetaLeadsNotConfiguredError";
  }
}

export interface MetaLeadgenPayload {
  /** Numeric leadgen_id emitted by Meta's webhook. */
  leadgen_id: string;
  /** Page id the ad was published from. */
  page_id: string;
  /** Ad + form ids so we can capture full hierarchy. */
  ad_id?: string;
  adgroup_id?: string; // adset in the Marketing API vocabulary
  campaign_id?: string;
  form_id: string;
  /** Server-side unix timestamp emitted by Meta. */
  created_time: number;
}

/** Fields we'd fetch from /v19.0/{leadgen_id}?fields=... */
export interface MetaLeadFieldSet {
  phone_number: string | null;
  full_name: string | null;
  email: string | null;
  raw_field_data: Array<{ name: string; values: string[] }>;
}

/** Whole record we'd insert into `leads` per verified leadgen event. */
export interface CapturedMetaLead extends MetaLeadgenPayload {
  fields: MetaLeadFieldSet;
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
}

/**
 * Verify the config on every call — never cache. Returns the list of missing
 * env keys so the caller can surface a specific error rather than a vague 501.
 */
export function missingMetaConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.META_APP_ID) missing.push("META_APP_ID");
  if (!process.env.META_APP_SECRET) missing.push("META_APP_SECRET");
  if (!process.env.META_LEADGEN_VERIFY_TOKEN) missing.push("META_LEADGEN_VERIFY_TOKEN");
  if (!process.env.META_LONG_LIVED_TOKEN) missing.push("META_LONG_LIVED_TOKEN");
  if (!isMetaLeadsEnabled()) missing.push("META_LEADS_ENABLED=true");
  return missing;
}

/**
 * SCAFFOLD ONLY. Would fetch the leadgen record from Meta's Graph API using
 * META_LONG_LIVED_TOKEN + META_APP_SECRET (appsecret_proof).
 *
 * NOT IMPLEMENTED. See docs/naman-ai/reports/lead-migration-phase-2-3-shipment.md
 * for the required Meta app permissions (leads_retrieval, pages_manage_metadata,
 * business_management), the long-lived-token refresh loop, and the App Review
 * requirement for `leads_retrieval`.
 */
export async function fetchLeadgenRecord(_payload: MetaLeadgenPayload): Promise<CapturedMetaLead> {
  const missing = missingMetaConfig();
  if (missing.length > 0) throw new MetaLeadsNotConfiguredError(missing);
  throw new Error(
    "fetchLeadgenRecord is a scaffold — the live Graph API fetch has not been implemented. " +
      "See docs/naman-ai/reports/lead-migration-phase-2-3-shipment.md § Phase 2C for the design.",
  );
}
