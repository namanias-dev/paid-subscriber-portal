-- ============================================================================
-- First-party marketing attribution on leads (additive, idempotent, non-destructive)
--   Persists the acquisition channel + UTM params + Google Ads click id on every
--   captured lead so the CRM can tag "Google Ads" leads and the Campaign
--   Performance report can group leads → webinar reg → sign-up by utm_campaign.
--   All fields are nullable and back-filled only going forward; existing rows are
--   untouched. `attribution` keeps the full first/last-touch JSONB for future use.
-- Nothing here sends or enables execution.
-- ============================================================================

alter table public.leads
  add column if not exists channel           text,
  add column if not exists utm_source        text,
  add column if not exists utm_medium        text,
  add column if not exists utm_campaign      text,
  add column if not exists utm_content       text,
  add column if not exists utm_term          text,
  add column if not exists gclid             text,
  add column if not exists landing_page_path text,
  add column if not exists referrer          text,
  add column if not exists attribution       jsonb;

-- Reporting/filtering indexes (partial — only rows that actually carry a signal).
create index if not exists idx_leads_channel      on public.leads (channel)      where channel is not null;
create index if not exists idx_leads_utm_campaign on public.leads (utm_campaign) where utm_campaign is not null;
