-- ============================================================================
-- ROLLBACK PAIR for `2026-07-21-attribution-full-capture.sql`.
--
-- ⚠️  MANUAL — DO NOT AUTO-APPLY. This file exists alongside the forward
-- migration only because the repo has no established rollback subdirectory
-- convention. Run BY HAND against the target DB ONLY when reverting the
-- attribution-full-capture shipment — e.g. if a downstream analytics job
-- unexpectedly depends on these columns being ABSENT (none is known to do so).
--
-- Preferred first-line reversal is the ENV FLAG (no DB change required):
--   Vercel → Project Settings → Environment Variables →
--     ATTRIBUTION_FULL_CAPTURE_ENABLED=false   (any environment)
-- That immediately reverts writes to the pre-shipment column set. Only run
-- this SQL file if the flag flip is insufficient (e.g. the columns themselves
-- must be dropped).
--
-- Reversibility:
--   * DROP INDEX IF EXISTS + DROP COLUMN IF EXISTS are idempotent — a second
--     run is a no-op.
--   * Existing rows lose only the values in the dropped columns; every other
--     column (payment amount, status, phone, etc.) is untouched.
-- ============================================================================

drop index if exists public.idx_payments_attribution_platform;
drop index if exists public.idx_payments_attribution_campaign_id;
drop index if exists public.idx_payments_attribution_ad_id;
drop index if exists public.idx_webreg_attribution_platform;
drop index if exists public.idx_webreg_attribution_campaign_id;
drop index if exists public.idx_webreg_attribution_ad_id;

alter table public.payments
  drop column if exists attribution_platform,
  drop column if exists attribution_utm_term,
  drop column if exists attribution_utm_content,
  drop column if exists attribution_ad_name,
  drop column if exists attribution_ad_id,
  drop column if exists attribution_adset_id,
  drop column if exists attribution_campaign_id;

alter table public.webinar_registrations
  drop column if exists attribution_platform,
  drop column if exists attribution_utm_term,
  drop column if exists attribution_utm_content,
  drop column if exists attribution_ad_name,
  drop column if exists attribution_ad_id,
  drop column if exists attribution_adset_id,
  drop column if exists attribution_campaign_id;
