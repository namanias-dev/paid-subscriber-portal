-- ============================================================================
-- SMS saved audiences (ADDITIVE — breaks nothing).
--
-- Backs Mission Control "Saved audiences": a marketer builds a composable filter
-- combination (course / webinar / payment status / time frame) in the Send tab
-- and saves it by name so it can be reloaded in one click on the next campaign.
--
-- Stores ONLY the filter spec (a jsonb FilterSpec) — never a frozen recipient
-- list, so a reloaded audience always re-resolves against live data. Same access
-- model as sms_settings / sms_variables: service-role only (all reads/writes go
-- through guarded admin API routes). If this table is absent the feature simply
-- shows no saved audiences (no regression to sending).
-- ============================================================================
create table if not exists public.sms_saved_audiences (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  spec       jsonb not null default '{}',   -- FilterSpec { courseSlug, webinarSlug, paymentStatus, timeframe, month }
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sms_saved_audiences_created_at_idx on public.sms_saved_audiences (created_at desc);

alter table public.sms_saved_audiences enable row level security;
-- No policies => only the service role (used by guarded admin APIs) can read/write.
