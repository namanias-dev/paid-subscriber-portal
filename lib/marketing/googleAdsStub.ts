/**
 * Google Ads API — STUB ONLY. NOT IMPLEMENTED. NO LIVE CALLS. NO SECRETS.
 * =============================================================================
 * This file lays out the shape of a FUTURE integration that would pull spend /
 * impressions / clicks per campaign from the Google Ads API to compute
 * cost-per-lead and ROAS, keyed by utm_campaign (or the Google Ads campaign id).
 *
 * It deliberately makes ZERO network calls and reads ZERO secrets. Every function
 * throws `GoogleAdsNotConfiguredError` so nothing can silently "half-work". The
 * first-party lead attribution + Campaign Performance report already shipped are
 * fully functional WITHOUT any of this — this only adds the cost/ROAS layer.
 *
 * TO BUILD LATER (see docs/reports/google-ads-attribution-guide.md):
 *   1. Google Ads API access: a Google Ads Manager (MCC) account + an approved
 *      DEVELOPER TOKEN.
 *   2. An OAuth2 client (client_id + client_secret) and a long-lived REFRESH
 *      TOKEN for the account that can read the campaigns.
 *   3. The target LOGIN customer id + the account customer id.
 *   4. Env vars (server-only; NEVER commit): GOOGLE_ADS_DEVELOPER_TOKEN,
 *      GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN,
 *      GOOGLE_ADS_LOGIN_CUSTOMER_ID, GOOGLE_ADS_CUSTOMER_ID.
 *   5. A GAQL query over `campaign` + `metrics` for the date range, then join
 *      spend → our per-campaign lead counts (campaignReport.ts) by utm_campaign
 *      to compute cost-per-lead and (with revenue) ROAS.
 */

export interface GoogleAdsCampaignSpend {
  /** Google Ads campaign id. */
  campaignId: string;
  /** Campaign name — expected to match the utm_campaign staff use in ad URLs. */
  campaignName: string;
  impressions: number;
  clicks: number;
  /** Spend in the account currency (micros / 1e6 in the real API). */
  costInr: number;
  dateFrom: string;
  dateTo: string;
}

export interface GoogleAdsPullOptions {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

/** Thrown by every stub method — the integration is intentionally not built. */
export class GoogleAdsNotConfiguredError extends Error {
  constructor() {
    super("Google Ads API integration is not configured. This is a stub — no live pull is implemented.");
    this.name = "GoogleAdsNotConfiguredError";
  }
}

/** Always false — there is no live integration to enable in this shipment. */
export function isGoogleAdsConfigured(): boolean {
  return false;
}

/**
 * STUB: would fetch per-campaign spend/clicks/impressions for the range.
 * Currently throws — do NOT call in production paths.
 */
export async function fetchGoogleAdsSpend(_opts: GoogleAdsPullOptions): Promise<GoogleAdsCampaignSpend[]> {
  throw new GoogleAdsNotConfiguredError();
}

/**
 * STUB: would join spend (by campaignName === utm_campaign) with our first-party
 * lead counts to produce cost-per-lead + ROAS. Not implemented.
 */
export interface CampaignCostRow {
  campaign: string;
  leads: number;
  costInr: number;
  costPerLeadInr: number | null;
  revenueInr: number | null;
  roas: number | null;
}
