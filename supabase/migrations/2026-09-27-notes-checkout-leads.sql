-- Additive checkout-lead table. Nullable, no rewrite of store_orders.
-- Service role only (RLS on, no policies), same as the rest of the store.

create table if not exists public.store_checkout_leads (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  phone_key text generated always as
    (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) stored,
  name text,
  email text,
  cart_id uuid,
  cart_snapshot jsonb not null default '[]'::jsonb,
  cart_value_paise integer not null default 0,
  checkout_stage text not null default 'CONTACT_CAPTURED'
    check (checkout_stage in (
      'CONTACT_CAPTURED',
      'DETAILS_IN_PROGRESS',
      'PAYMENT_INITIATED',
      'CHECKOUT_ABANDONED',
      'PAYMENT_ABANDONED',
      'CONVERTED',
      'EXPIRED'
    )),
  sales_status text not null default 'NEW'
    check (sales_status in ('NEW', 'CONTACTED', 'FOLLOW_UP', 'CONVERTED', 'NOT_INTERESTED', 'DO_NOT_CONTACT')),
  was_abandoned boolean not null default false,
  attribution_json jsonb,
  landing_path text,
  visitor_id text,
  session_id text,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  marketing_consent_source text,
  address_snapshot jsonb,
  order_id uuid,
  converted_at timestamptz,
  converted_value_paise integer,
  recovery_token_hash text,
  sales_note text,
  is_test boolean not null default false,
  redacted_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists store_checkout_leads_open_phone
  on public.store_checkout_leads (phone_key)
  where checkout_stage not in ('CONVERTED', 'EXPIRED') and length(phone_key) = 10;

create index if not exists store_checkout_leads_activity_idx
  on public.store_checkout_leads (last_activity_at desc);

create index if not exists store_checkout_leads_order_idx
  on public.store_checkout_leads (order_id)
  where order_id is not null;

alter table public.store_checkout_leads enable row level security;
revoke all on public.store_checkout_leads from public, anon, authenticated;
