/**
 * Full ad-identifier capture feature flag.
 *
 * Gates the WRITES of the new attribution columns
 * (`attribution_campaign_id`, `attribution_adset_id`, `attribution_ad_id`,
 * `attribution_ad_name`, `attribution_utm_content`, `attribution_utm_term`,
 * `attribution_platform`) on `webinar_registrations` and `payments`. READS of
 * those columns are unconditional — they're nullable text and safe to select
 * regardless of the flag.
 *
 * Default: ON. Flip to `"false"` (exact lowercase) via the Vercel env var
 * `ATTRIBUTION_FULL_CAPTURE_ENABLED=false` to kill the extra writes without a
 * redeploy. Any other value (including empty/unset) leaves the feature ON.
 *
 * Rationale: the old `attribution_source` / `attribution_campaign` columns
 * continue to be written EXACTLY as before regardless of this flag — the flag
 * only gates the NEW columns, so flipping it to `false` reverts write behavior
 * to the pre-shipment baseline without any redeploy or migration.
 */
export function isFullCaptureEnabled(): boolean {
  return process.env.ATTRIBUTION_FULL_CAPTURE_ENABLED !== "false";
}
