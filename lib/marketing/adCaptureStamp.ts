/**
 * Ad-level attribution stamp for the new nullable columns on
 * `webinar_registrations` and `payments`.
 *
 * PURE + client-safe: consumes a stored `AttributionState` and returns the flat
 * scalars that get INSERTed alongside the existing `attribution_source` /
 * `attribution_campaign` / `attribution_fbclid` / `attribution_fbc` columns.
 *
 * This is a thin ADAPTER over `lib/attribution.ts` — it does NOT fork the
 * platform-derivation predicates or the first-touch precedence. Both are read
 * off the same underlying touch object.
 *
 * FIRST-TOUCH WINS (same rule as `leadAttributionFromState`): the stamp comes
 * from the frozen first-touch when present, otherwise from the last-touch,
 * otherwise all-null (nothing invented). Nothing here writes to the DB.
 */
import {
  type AttributionState,
  type AttributionTouch,
  derivePlatform,
} from "@/lib/attribution";

export interface AdCaptureStamp {
  attribution_campaign_id: string | null;
  attribution_adset_id: string | null;
  attribution_ad_id: string | null;
  attribution_ad_name: string | null;
  attribution_utm_content: string | null;
  attribution_utm_term: string | null;
  attribution_platform: "meta" | "google" | "other" | null;
}

/** All-null stamp — matches the pre-shipment column baseline. */
export const EMPTY_AD_CAPTURE_STAMP: AdCaptureStamp = {
  attribution_campaign_id: null,
  attribution_adset_id: null,
  attribution_ad_id: null,
  attribution_ad_name: null,
  attribution_utm_content: null,
  attribution_utm_term: null,
  attribution_platform: null,
};

/** The scalar column names — kept in one place so writers and tests agree. */
export const AD_CAPTURE_SCALAR_COLUMNS = [
  "attribution_campaign_id",
  "attribution_adset_id",
  "attribution_ad_id",
  "attribution_ad_name",
  "attribution_utm_content",
  "attribution_utm_term",
  "attribution_platform",
] as const;

function nn(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

/**
 * Build the AdCaptureStamp from a stored attribution state. First-touch wins;
 * falls back to last-touch; returns EMPTY_AD_CAPTURE_STAMP when neither exists.
 * Never fabricates a value — an absent field on the touch stays null.
 */
export function adCaptureStampFromState(state: AttributionState | null): AdCaptureStamp {
  const touch: AttributionTouch | null = state?.first_touch || state?.last_touch || null;
  if (!touch) return EMPTY_AD_CAPTURE_STAMP;
  return {
    attribution_campaign_id: nn(touch.campaign_id),
    attribution_adset_id: nn(touch.adset_id),
    attribution_ad_id: nn(touch.ad_id),
    attribution_ad_name: nn(touch.ad_name),
    attribution_utm_content: nn(touch.content),
    attribution_utm_term: nn(touch.term),
    attribution_platform: derivePlatform(touch),
  };
}
