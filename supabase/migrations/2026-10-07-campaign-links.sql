-- Campaign Links: branded short links + click log for paid/organic acquisition.
--
-- ADDITIVE + IDEMPOTENT. Creates two new tables and their indexes only. No
-- existing table, column, or attribution data is touched — the campaign-link id
-- (`clid`) rides the EXISTING `nsa_attr` JSONB touch (lib/attribution.ts), so
-- analytics_events.attribution, leads.attribution, buyers.first_touch/last_touch
-- and store_orders.attribution_json pick it up with no schema change to them.

-- 1) The campaign link entity ------------------------------------------------
create table if not exists public.campaign_links (
  id                   uuid primary key default gen_random_uuid(),
  short_code           text not null,
  destination_url      text not null,
  destination_type     text not null default 'custom',   -- webinar|notes|course|demo|landing|custom
  destination_id       text,
  name                 text not null,
  description          text,
  status               text not null default 'active',    -- active|paused|archived
  -- Canonical, slugified attribution (also baked into destination_url as utm_*).
  source               text,
  medium               text,
  platform             text,
  campaign             text,
  campaign_id_external text,
  adset_name           text,
  adset_id_external    text,
  ad_name              text,
  ad_id_external       text,
  creative_name        text,
  content              text,
  term                 text,
  placement            text,
  channel              text,
  tags                 jsonb not null default '[]'::jsonb,
  owner                text,
  created_by           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  archived_at          timestamptz,
  constraint campaign_links_status_chk check (status in ('active','paused','archived'))
);

-- Case-insensitive uniqueness so /go/Officer and /go/officer never collide.
create unique index if not exists uq_campaign_links_short_code
  on public.campaign_links (lower(short_code));
create index if not exists idx_campaign_links_created_at
  on public.campaign_links (created_at desc);
create index if not exists idx_campaign_links_status
  on public.campaign_links (status);

-- 2) The click log -----------------------------------------------------------
create table if not exists public.campaign_link_clicks (
  id               uuid primary key default gen_random_uuid(),
  campaign_link_id uuid not null references public.campaign_links(id) on delete cascade,
  short_code       text not null,
  occurred_at      timestamptz not null default now(),
  visitor_id       text,
  session_id       text,
  destination_url  text,
  referrer         text,
  user_agent       text,
  device           jsonb,
  fbclid           text,
  gclid            text,
  wbraid           text,
  gbraid           text,
  is_bot           boolean not null default false
);

create index if not exists idx_clc_link_time
  on public.campaign_link_clicks (campaign_link_id, occurred_at desc);
create index if not exists idx_clc_short_code
  on public.campaign_link_clicks (short_code);
create index if not exists idx_clc_visitor
  on public.campaign_link_clicks (visitor_id);
create index if not exists idx_clc_time_active
  on public.campaign_link_clicks (occurred_at desc) where is_bot = false;
