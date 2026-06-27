-- ============================================================================
-- In-house analytics + attribution (additive, idempotent)
--   • analytics_events  — single envelope+props event log (business + traffic)
--   • analytics_daily   — nightly behavioral rollup (revenue stays live via
--                          paymentsAgg over `payments`, so numbers reconcile)
--   • attribution columns on buyers / payments / webinar_registrations
-- Nothing here alters existing tables' data; all adds are nullable / IF NOT EXISTS.
-- ============================================================================

-- ---- Event log --------------------------------------------------------------
create table if not exists public.analytics_events (
  event_id        uuid primary key default gen_random_uuid(),
  schema_version  integer not null default 1,
  event_name      text not null,
  visitor_id      text,
  buyer_id        uuid,
  phone           text,
  session_id      text,
  occurred_at     timestamptz not null default now(),
  page_path       text,
  referrer        text,
  device          jsonb,
  is_bot          boolean not null default false,
  attribution     jsonb,
  props           jsonb,
  -- Set ONLY for idempotent milestones (e.g. "paid:<ref>"); guarantees one write.
  dedupe_key      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ae_name_time    on public.analytics_events (event_name, occurred_at desc);
create index if not exists idx_ae_buyer_time   on public.analytics_events (buyer_id, occurred_at desc);
create index if not exists idx_ae_visitor_time on public.analytics_events (visitor_id, occurred_at desc);
create index if not exists idx_ae_phone        on public.analytics_events (phone);
create unique index if not exists uq_ae_dedupe on public.analytics_events (dedupe_key) where dedupe_key is not null;

-- ---- Daily behavioral rollup (revenue/seats stay live from payments) --------
create table if not exists public.analytics_daily (
  day         date primary key,
  metrics     jsonb not null default '{}'::jsonb,   -- {visitors,sessions,page_views,...}
  by_source   jsonb not null default '{}'::jsonb,   -- {instagram:{visitors,registrations,...},...}
  updated_at  timestamptz not null default now()
);

-- ---- Attribution stamped on the identity / transaction records --------------
alter table public.buyers
  add column if not exists first_touch          jsonb,
  add column if not exists last_touch           jsonb,
  add column if not exists attribution_source   text,
  add column if not exists attribution_campaign text,
  add column if not exists last_seen_at         timestamptz;

alter table public.payments
  add column if not exists attribution_source   text,
  add column if not exists attribution_campaign text;

alter table public.webinar_registrations
  add column if not exists attribution_source   text,
  add column if not exists attribution_campaign text;

create index if not exists idx_buyers_attr_source   on public.buyers (attribution_source);
create index if not exists idx_payments_attr_source on public.payments (attribution_source);
