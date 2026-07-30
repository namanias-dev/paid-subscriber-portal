-- Meta Lead Ads ingestion (additive). Idempotent on Meta leadgen_id.
-- Indexes marked CONCURRENTLY: apply outside a transaction in SQL editor if needed.

create table if not exists public.meta_lead_ingestions (
  id text primary key,
  leadgen_id text not null,
  lead_id text references public.leads(id) on delete set null,
  page_id text,
  form_id text,
  form_name text,
  ad_id text,
  adset_id text,
  campaign_id text,
  campaign_name text,
  platform text,
  meta_created_at timestamptz,
  ingested_at timestamptz not null default now(),
  outcome text not null,
  error_message text,
  handler_ms int,
  signature_valid boolean not null default true,
  raw_webhook jsonb,
  raw_lead jsonb,
  field_data jsonb,
  phone_key text,
  no_usable_contact boolean not null default false,
  constraint meta_lead_ingestions_leadgen_id_key unique (leadgen_id),
  constraint meta_lead_ingestions_outcome_check check (
    outcome = any (array[
      'created'::text,
      'attached_existing'::text,
      'duplicate'::text,
      'failed'::text,
      'pending_retry'::text
    ])
  )
);

create index if not exists idx_meta_lead_ingestions_ingested_at
  on public.meta_lead_ingestions (ingested_at desc);

create index if not exists idx_meta_lead_ingestions_retry
  on public.meta_lead_ingestions (ingested_at desc)
  where outcome in ('failed', 'pending_retry');

alter table public.leads
  add column if not exists meta_leadgen_id text,
  add column if not exists meta_ingested_at timestamptz;

comment on column public.leads.meta_leadgen_id is
  'Latest Meta leadgen_id attached to this lead (nullable). Unique when set.';
comment on column public.leads.meta_ingested_at is
  'When this lead was last ingested/updated from a Meta Lead Ad webhook.';

-- Unique only when set (partial). Prefer CONCURRENTLY in production:
-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_meta_leadgen_id
--   ON public.leads (meta_leadgen_id) WHERE meta_leadgen_id IS NOT NULL;
create unique index if not exists idx_leads_meta_leadgen_id
  on public.leads (meta_leadgen_id)
  where meta_leadgen_id is not null;
