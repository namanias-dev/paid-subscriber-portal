-- ============================================================================
-- Close the Meta attribution funnel (additive, idempotent, non-destructive)
--   • webinar_registrations — carry Meta click ids (fbclid/fbc) alongside the
--     source/campaign already added by 2026-analytics-attribution.sql, so a free
--     registration can be matched to its ad without any PII.
--   • meta_capi_log — small delivery log for the server-side Conversions API so
--     we can prove a 2xx + events_received (or surface an error) without ever
--     blocking the user flow.
-- Nothing here alters existing rows; every add is nullable / IF NOT EXISTS.
-- ============================================================================

-- ---- First-party conversion capture on the (free) registration --------------
alter table public.webinar_registrations
  add column if not exists attribution_fbclid text,
  add column if not exists attribution_fbc    text;

create index if not exists idx_webinar_regs_attr_campaign
  on public.webinar_registrations (attribution_campaign);

-- ---- CAPI delivery log (best-effort, failure-safe) --------------------------
create table if not exists public.meta_capi_log (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  event_name       text not null,
  event_id         text,
  ok               boolean not null default false,
  http_status      integer,
  events_received  integer,
  fbtrace_id       text,
  test_mode        boolean not null default false,
  error            jsonb
);

create index if not exists idx_meta_capi_log_created on public.meta_capi_log (created_at desc);
create index if not exists idx_meta_capi_log_event   on public.meta_capi_log (event_name, created_at desc);
