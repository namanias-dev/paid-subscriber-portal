-- ============================================================================
-- FULL AD-IDENTIFIER CAPTURE — additive attribution columns for the full
-- Meta + Google ad hierarchy (campaign_id / adset_id / ad_id / ad_name), plus
-- utm_content / utm_term / derived platform. ADDITIVE + NULLABLE.
--
-- Safe on production:
--   * Every column is nullable with no default and no backfill — old rows keep
--     working with NULL, new writes fill the columns when the visitor's
--     nsa_attr cookie carries the ids (Postgres 11+ adds nullable columns as a
--     metadata-only change: no table rewrite, no locks on big tables).
--   * Never renames or removes an existing column. `attribution_source` and
--     `attribution_campaign` remain populated by the same code paths as before
--     for full compatibility.
--   * Feature-flagged in code (`ATTRIBUTION_FULL_CAPTURE_ENABLED`, default ON;
--     flip to `"false"` to silence the new writes without a redeploy).
--
-- Reversible via `2026-07-21-attribution-full-capture-rollback.sql`.
-- ============================================================================

alter table public.webinar_registrations
  add column if not exists attribution_campaign_id text,
  add column if not exists attribution_adset_id    text,
  add column if not exists attribution_ad_id       text,
  add column if not exists attribution_ad_name     text,
  add column if not exists attribution_utm_content text,
  add column if not exists attribution_utm_term    text,
  add column if not exists attribution_platform    text;

alter table public.payments
  add column if not exists attribution_campaign_id text,
  add column if not exists attribution_adset_id    text,
  add column if not exists attribution_ad_id       text,
  add column if not exists attribution_ad_name     text,
  add column if not exists attribution_utm_content text,
  add column if not exists attribution_utm_term    text,
  add column if not exists attribution_platform    text;

-- Filter/group indexes for reports (partial — only rows that carry a signal).
-- Each keeps its table lean while making "campaigns by ad_id" and "platform
-- breakdown" queries cheap. Nullable, so unaffected rows never enter the index.
create index if not exists idx_webreg_attribution_ad_id       on public.webinar_registrations (attribution_ad_id)       where attribution_ad_id is not null;
create index if not exists idx_webreg_attribution_campaign_id on public.webinar_registrations (attribution_campaign_id) where attribution_campaign_id is not null;
create index if not exists idx_webreg_attribution_platform    on public.webinar_registrations (attribution_platform)    where attribution_platform is not null;

create index if not exists idx_payments_attribution_ad_id       on public.payments (attribution_ad_id)       where attribution_ad_id is not null;
create index if not exists idx_payments_attribution_campaign_id on public.payments (attribution_campaign_id) where attribution_campaign_id is not null;
create index if not exists idx_payments_attribution_platform    on public.payments (attribution_platform)    where attribution_platform is not null;
