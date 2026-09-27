-- Additive delivery-address confirmation. Existing rows stay unconfirmed.

alter table public.store_addresses add column if not exists confirmation_status text;
alter table public.store_addresses add column if not exists confirmed_at timestamptz;
alter table public.store_addresses add column if not exists confirmed_by text;
alter table public.store_addresses add column if not exists verification_method text;
alter table public.store_addresses add column if not exists address_hash text;
alter table public.store_addresses add column if not exists raw_line1 text;
alter table public.store_addresses add column if not exists raw_line2 text;
alter table public.store_addresses add column if not exists raw_city text;
alter table public.store_addresses add column if not exists raw_state text;

alter table public.store_checkout_leads add column if not exists address_confirmed boolean not null default false;

create table if not exists public.store_order_address_versions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  previous_address jsonb,
  next_address jsonb,
  reason text,
  customer_confirmed boolean not null default false,
  confirmation_status text,
  shipment_status text,
  previous_awb text,
  next_awb text,
  changed_by text,
  created_at timestamptz not null default now()
);

create index if not exists store_order_address_versions_order_idx
  on public.store_order_address_versions (order_id, created_at desc);

alter table public.store_order_address_versions enable row level security;
revoke all on public.store_order_address_versions from public, anon, authenticated;
