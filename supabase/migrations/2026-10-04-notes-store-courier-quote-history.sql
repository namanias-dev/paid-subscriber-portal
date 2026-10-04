-- Courier quote history: an immutable record of every Compare Couriers result
-- staff saw, and every booking attempt made from it.
--
-- Additive only. No existing table or row is changed. Idempotent.
-- ORDER -> QUOTE SESSION -> QUOTE OPTIONS -> BOOKING ATTEMPTS -> SHIPMENT
--
-- Sessions and options are written once and never updated. A booking attempt
-- row is created before the provider create call, and only its outcome
-- columns are filled in afterwards.
-- No street address, phone, email or raw provider payload is stored here.

create table if not exists public.store_courier_quote_sessions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders (id) on delete cascade,
  -- One Compare Couriers action. A repeated request with the same key reuses the session.
  request_key text,
  created_at timestamptz not null default now(),
  created_by_id text,
  created_by_name text,
  package_weight_grams integer not null,
  package_length_mm integer not null,
  package_width_mm integer not null,
  package_height_mm integer not null,
  package_source text,
  destination_city text,
  destination_state text,
  destination_pincode text not null,
  -- sha256 of the resolved package and the delivery address. Booking requires an exact match.
  booking_fingerprint text not null,
  expires_at timestamptz not null,
  currency text not null default 'INR',
  total_quote_count integer not null default 0,
  eligible_quote_count integer not null default 0,
  cheapest_eligible_paise integer,
  -- Per provider: configured / ok / quote count / error category. No raw errors.
  provider_outcomes jsonb not null default '[]'::jsonb
);

create unique index if not exists store_courier_quote_sessions_request_uq
  on public.store_courier_quote_sessions (request_key) where request_key is not null;
create index if not exists store_courier_quote_sessions_order_idx
  on public.store_courier_quote_sessions (order_id, created_at desc);

create table if not exists public.store_courier_quote_options (
  id uuid primary key default gen_random_uuid(),
  quote_session_id uuid not null references public.store_courier_quote_sessions (id) on delete cascade,
  order_id uuid not null references public.store_orders (id) on delete cascade,
  -- Row order exactly as shown to staff (1 = first row).
  position integer not null,
  provider text not null,
  courier_name text not null,
  service_name text,
  courier_id text,
  transport_mode text,
  quoted_rate_paise integer not null check (quoted_rate_paise >= 0),
  eta_days integer,
  eta_text text,
  eligible boolean not null,
  eligibility_reason text,
  is_cheapest_eligible boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists store_courier_quote_options_session_idx
  on public.store_courier_quote_options (quote_session_id, position);
create index if not exists store_courier_quote_options_rate_idx
  on public.store_courier_quote_options (quote_session_id, quoted_rate_paise);

create table if not exists public.store_courier_booking_attempts (
  id uuid primary key default gen_random_uuid(),
  quote_session_id uuid not null references public.store_courier_quote_sessions (id) on delete cascade,
  quote_option_id uuid not null references public.store_courier_quote_options (id) on delete cascade,
  order_id uuid not null references public.store_orders (id) on delete cascade,
  created_at timestamptz not null default now(),
  selected_by_id text,
  selected_by_name text,
  status text not null default 'BOOKING' check (status in ('BOOKING', 'BOOKED', 'CITY_CONFIRM', 'FAILED', 'BLOCKED')),
  failure_category text,
  failure_message text,
  quoted_rate_paise integer not null,
  cheapest_eligible_paise integer,
  premium_paise integer,
  shipment_id uuid references public.store_shipments (id) on delete set null,
  awb text,
  completed_at timestamptz
);

create index if not exists store_courier_booking_attempts_session_idx
  on public.store_courier_booking_attempts (quote_session_id, created_at);
create index if not exists store_courier_booking_attempts_order_idx
  on public.store_courier_booking_attempts (order_id, created_at desc);
create index if not exists store_courier_booking_attempts_shipment_idx
  on public.store_courier_booking_attempts (shipment_id) where shipment_id is not null;

-- Server (service role) only, like every other store_* table.
alter table public.store_courier_quote_sessions enable row level security;
alter table public.store_courier_quote_options enable row level security;
alter table public.store_courier_booking_attempts enable row level security;
revoke all on public.store_courier_quote_sessions from anon, authenticated;
revoke all on public.store_courier_quote_options from anon, authenticated;
revoke all on public.store_courier_booking_attempts from anon, authenticated;
