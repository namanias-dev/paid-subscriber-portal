-- ============================================================================
-- Notes Store — Phase 1A schema. ISOLATION LAYER 1 of 4.
--
-- Every table is store_*. There is NO foreign key from any table here into
-- payments, students, buyers, course_enrollments, leads or any entitlement or
-- fee-state table. The ONLY link to academy identity is `phone_key`, a plain
-- generated text column used for read-time joins — a join key, not a
-- relationship. Nothing in this file can be reached by a course code path.
--
-- Money is INTEGER PAISE everywhere. No floats, no numeric, no rupees.
-- No COD: there is no payment_mode, no cod_* column, and no COD table, at any
-- phase. Serviceability answers deliverability and ETA only.
--
-- RLS is enabled with no policies, matching supabase/schema.sql:767-795 — all
-- access is via the service role from server code.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------- categories
-- Subjects (§5). Slug feeds /notes/[subject].
create table if not exists public.store_categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  -- Store nav label. "CA Compilations" for current-affairs, so the store never
  -- competes with the academy's existing /current-affairs pages.
  nav_label text,
  short_description text,
  description_md text,
  cover_image_key text,
  position integer not null default 0,
  is_active boolean not null default true,
  seo_title text,
  seo_description text,
  seo_image_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------- products
-- Field set per §5. `kind` lets a bundle be a purchasable SKU in Phase 1
-- without a bundle pricing engine (that is Phase 4); its components live in
-- store_bundle_items and are exploded onto the pick list.
create table if not exists public.store_products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  slug text unique not null,
  kind text not null default 'single' check (kind in ('single', 'bundle')),
  name text not null,
  short_name text,
  category_id uuid references public.store_categories (id) on delete restrict,
  subject text,
  stage text check (stage in ('prelims', 'mains', 'both')),
  language text not null default 'english',
  edition text,
  short_description text,
  description_md text,
  page_count integer,
  -- Shipping inputs. Grams and millimetres, integers.
  weight_grams integer,
  length_mm integer,
  width_mm integer,
  height_mm integer,
  binding_type text,
  printing_type text,
  cover_image_key text,
  video_url text,
  -- Pricing, paise.
  mrp_paise integer not null check (mrp_paise >= 0),
  selling_price_paise integer not null check (selling_price_paise >= 0),
  cost_price_paise integer check (cost_price_paise >= 0),
  -- Inventory. `reserved` is maintained by the reservation RPC only.
  on_hand integer not null default 0,
  reserved integer not null default 0 check (reserved >= 0),
  incoming integer not null default 0 check (incoming >= 0),
  low_stock_threshold integer not null default 5,
  -- Phase 1 ruling: present in schema, flags off, untested.
  allow_backorder boolean not null default false,
  is_preorder boolean not null default false,
  max_quantity_per_order integer not null default 5 check (max_quantity_per_order > 0),
  is_featured boolean not null default false,
  is_bestseller boolean not null default false,
  is_active boolean not null default false,
  -- Fulfilment promise inputs. estimated_delivery_days is a fallback only; the
  -- quoted date comes from dispatch_days + zone transit + the Phase 1 buffer.
  dispatch_days integer not null default 2 check (dispatch_days >= 0),
  estimated_delivery_days integer,
  -- Tax is configurable per product and NEVER hard-coded. Pending the CA's
  -- position on HSN 4901 vs 4820, treatment defaults to 'exempt' with a zero
  -- rate; changing it is a data edit, not a deploy.
  hsn_code text,
  tax_treatment text not null default 'exempt'
    check (tax_treatment in ('exempt', 'nil', 'taxable')),
  tax_rate_bps integer not null default 0 check (tax_rate_bps >= 0 and tax_rate_bps <= 10000),
  seo_title text,
  seo_description text,
  seo_image_key text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_products_price_not_above_mrp check (selling_price_paise <= mrp_paise)
);

create index if not exists store_products_active_idx
  on public.store_products (is_active, position) where is_active;
create index if not exists store_products_category_idx
  on public.store_products (category_id, position);
create index if not exists store_products_bestseller_idx
  on public.store_products (is_bestseller, position) where is_active and is_bestseller;

-- Bundle composition. Restrict delete so a component cannot vanish from a
-- sellable bundle silently.
create table if not exists public.store_bundle_items (
  bundle_id uuid not null references public.store_products (id) on delete cascade,
  component_id uuid not null references public.store_products (id) on delete restrict,
  qty integer not null default 1 check (qty > 0),
  position integer not null default 0,
  primary key (bundle_id, component_id)
);

-- ---------------------------------------------------------------------- media
-- kind='sample_page' rows are ALWAYS private (§6): stored under a private R2
-- prefix, served only through the store's own route, watermark baked into the
-- pixels at upload. `original_key` is the un-watermarked source and is never
-- returned to a client under any circumstance.
create table if not exists public.store_product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.store_products (id) on delete cascade,
  kind text not null check (kind in ('photo', 'sample_page')),
  r2_key text not null,
  original_key text,
  width integer,
  height integer,
  bytes integer,
  alt text,
  -- Sample pages are deliberately non-contiguous; this records which printed
  -- page a preview came from so the set can be checked for contiguity.
  source_page_no integer,
  is_public boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint store_media_sample_is_private
    check (kind <> 'sample_page' or is_public = false)
);

create index if not exists store_product_media_product_idx
  on public.store_product_media (product_id, kind, position);

-- ------------------------------------------------------------- stock movement
-- Append-only. store_products.on_hand is the fast read; this is the truth and
-- the audit trail. Reconciled by a periodic job.
create table if not exists public.store_stock_ledger (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.store_products (id) on delete restrict,
  delta integer not null,
  reason text not null check (reason in (
    'receipt', 'reserve', 'release', 'commit', 'adjust', 'rto_restock', 'damage', 'recount'
  )),
  ref_type text,
  ref_id text,
  actor_id text,
  actor_name text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists store_stock_ledger_product_idx
  on public.store_stock_ledger (product_id, created_at desc);

-- Reservations are taken at "Pay", not at add-to-cart, and expire.
create table if not exists public.store_inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.store_products (id) on delete restrict,
  cart_id uuid,
  order_id uuid,
  qty integer not null check (qty > 0),
  expires_at timestamptz not null,
  released_at timestamptz,
  committed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists store_reservations_active_idx
  on public.store_inventory_reservations (product_id)
  where released_at is null and committed_at is null;
create index if not exists store_reservations_sweep_idx
  on public.store_inventory_reservations (expires_at)
  where released_at is null and committed_at is null;
create index if not exists store_reservations_order_idx
  on public.store_inventory_reservations (order_id);

-- ------------------------------------------------------------------ customers
-- NOT an account. No login code, no password, no session, no entitlement.
-- Guest checkout writes here and nowhere else in the identity space.
create table if not exists public.store_customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  phone_key text generated always as
    (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) stored,
  name text,
  email text,
  first_order_at timestamptz,
  orders_count integer not null default 0,
  delivered_count integer not null default 0,
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists store_customers_phone_key_uq
  on public.store_customers (phone_key) where length(phone_key) = 10;

-- Addresses are order snapshots in Phase 1 (a reusable address book is Phase 3).
create table if not exists public.store_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.store_customers (id) on delete set null,
  kind text not null default 'shipping' check (kind in ('shipping', 'billing')),
  name text not null,
  phone text not null,
  line1 text not null,
  line2 text,
  landmark text,
  city text not null,
  state text not null,
  pincode text not null,
  country text not null default 'IN',
  delivery_instructions text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------- cart
-- The client holds only an opaque id in an httpOnly cookie. No prices and no
-- PII live in the cookie, so a cached page can never embed cart state.
create table if not exists public.store_carts (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'open'
    check (status in ('open', 'converted', 'abandoned', 'merged')),
  -- Prefill only. Never used to grant anything.
  buyer_phone_key text,
  promo_code text,
  -- The frozen priced quote. Capture validates against this, never the cart.
  quote_json jsonb,
  quote_locked_at timestamptz,
  quote_expires_at timestamptz,
  attribution_json jsonb,
  visitor_id text,
  session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists store_carts_expiry_idx
  on public.store_carts (expires_at) where status = 'open';

create table if not exists public.store_cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.store_carts (id) on delete cascade,
  product_id uuid not null references public.store_products (id) on delete restrict,
  qty integer not null check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, product_id)
);

-- --------------------------------------------------------------------- orders
-- Internal states are the full §9 set. PAYMENT_FAILED and PAYMENT_EXPIRED are
-- additive to that list: §9 has no terminal for a checkout that never pays, and
-- without one, reserved stock could never be released. The customer-facing
-- projection (Confirmed → Preparing → Shipped → Out for Delivery → Delivered)
-- is computed in code and never stored.
create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique,
  status text not null default 'PAYMENT_PENDING' check (status in (
    'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED',
    'PAYMENT_CONFIRMED', 'ORDER_CONFIRMED', 'PROCESSING', 'PRINTING',
    'QUALITY_CHECK', 'READY_TO_PACK', 'PACKED', 'READY_FOR_PICKUP',
    'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY',
    'DELIVERED', 'DELIVERY_FAILED', 'REATTEMPT_REQUESTED',
    'RTO_INITIATED', 'RTO_IN_TRANSIT', 'RTO_DELIVERED',
    'CANCEL_REQUESTED', 'CANCELLED',
    'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_PICKUP_SCHEDULED',
    'RETURN_IN_TRANSIT', 'RETURN_RECEIVED',
    'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED'
  )),
  customer_id uuid references public.store_customers (id) on delete restrict,
  cart_id uuid references public.store_carts (id) on delete set null,
  -- Snapshot, not a join: a phone correction later must not rewrite an order.
  customer_name text not null,
  phone text not null,
  phone_key text generated always as
    (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) stored,
  email text,
  shipping_address_id uuid references public.store_addresses (id) on delete restrict,
  billing_address_id uuid references public.store_addresses (id) on delete restrict,
  -- Money, paise. Recomputed server-side from the frozen quote at capture.
  subtotal_paise integer not null default 0,
  discount_paise integer not null default 0,
  shipping_paise integer not null default 0,
  tax_paise integer not null default 0,
  total_paise integer not null default 0 check (total_paise >= 0),
  amount_paid_paise integer not null default 0 check (amount_paid_paise >= 0),
  amount_refunded_paise integer not null default 0 check (amount_refunded_paise >= 0),
  promo_code text,
  discount_trace_json jsonb,
  quote_json jsonb,
  -- Fulfilment promise made to the customer, kept for accountability.
  promised_delivery_date date,
  dispatch_due_date date,
  -- Tracking without login: order_no + phone, or this token.
  tracking_token text,
  internal_notes text,
  -- Attribution mirrors the payments column names for reporting parity WITHOUT
  -- sharing the table. First touch is frozen upstream by mergeAttribution().
  attribution_json jsonb,
  attribution_source text,
  attribution_campaign text,
  attribution_campaign_id text,
  attribution_adset_id text,
  attribution_ad_id text,
  attribution_platform text,
  visitor_id text,
  session_id text,
  placed_at timestamptz not null default now(),
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The admin queue's only ordering, and the working set stays ~a day of rows.
create index if not exists store_orders_queue_idx
  on public.store_orders (status, placed_at desc);
create index if not exists store_orders_open_idx
  on public.store_orders (placed_at desc)
  where status in ('PAYMENT_CONFIRMED', 'ORDER_CONFIRMED', 'PROCESSING', 'PRINTING',
                   'QUALITY_CHECK', 'READY_TO_PACK', 'PACKED', 'READY_FOR_PICKUP',
                   'PICKUP_SCHEDULED');
create index if not exists store_orders_phone_idx
  on public.store_orders (phone_key, placed_at desc);
create index if not exists store_orders_paid_idx
  on public.store_orders (paid_at desc) where paid_at is not null;
create unique index if not exists store_orders_tracking_token_uq
  on public.store_orders (tracking_token) where tracking_token is not null;

-- Line snapshots. A later price or title change must never rewrite history.
create table if not exists public.store_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders (id) on delete cascade,
  product_id uuid not null references public.store_products (id) on delete restrict,
  -- Set when this line came from exploding a bundle, for the pick list.
  parent_bundle_id uuid references public.store_products (id) on delete restrict,
  name_snapshot text not null,
  sku_snapshot text not null,
  qty integer not null check (qty > 0),
  unit_price_paise integer not null check (unit_price_paise >= 0),
  line_discount_paise integer not null default 0,
  line_total_paise integer not null,
  tax_treatment_snapshot text,
  tax_rate_bps_snapshot integer,
  tax_paise integer not null default 0,
  hsn_snapshot text,
  weight_grams_snapshot integer,
  created_at timestamptz not null default now()
);

create index if not exists store_order_items_order_idx
  on public.store_order_items (order_id);
create index if not exists store_order_items_pick_idx
  on public.store_order_items (product_id, order_id);

-- Append-only audit spine: every money, inventory and state change.
create table if not exists public.store_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.store_orders (id) on delete cascade,
  event text not null,
  from_status text,
  to_status text,
  actor_type text not null default 'system'
    check (actor_type in ('system', 'admin', 'customer', 'courier', 'gateway')),
  actor_id text,
  actor_name text,
  reason text,
  before_json jsonb,
  after_json jsonb,
  payload_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists store_order_events_order_idx
  on public.store_order_events (order_id, created_at desc);
create index if not exists store_order_events_event_idx
  on public.store_order_events (event, created_at desc);

-- ------------------------------------------------------------------- payments
-- The store's own ledger. NOTHING here ever touches public.payments, which is
-- additionally pinned by a check constraint to ('course','webinar','plan').
create table if not exists public.store_order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders (id) on delete restrict,
  provider text not null default 'ICICI_EAZYPAY',
  -- Our reference, always NIASN-N-…; the store's routing and cron key.
  reference_no text not null,
  sub_merchant_id text,
  -- Gateway transaction id (ICICI "Unique Ref Number" / ezpaytranid).
  gateway_ref text,
  -- Store-owned status vocabulary. Deliberately NOT the course enum.
  status text not null default 'INITIATED' check (status in (
    'INITIATED', 'UNCONFIRMED', 'VERIFYING', 'CAPTURED',
    'FAILED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED'
  )),
  settlement text check (settlement in ('settled', 'in_progress')),
  method text,
  amount_paise integer not null check (amount_paise >= 0),
  -- What ICICI echoed back, in rupees as sent by the gateway, for audit only.
  gateway_amount text,
  response_code text,
  verified_signature boolean,
  transaction_date text,
  -- Verify backoff bookkeeping (store's own cron, never the course cron).
  verify_attempts integer not null default 0,
  last_verify_at timestamptz,
  next_verify_at timestamptz,
  raw_verify_status text,
  callback_payload jsonb,
  verify_payload jsonb,
  refund_ref text,
  refund_status text,
  refunded_amount_paise integer not null default 0,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_payment_ref_namespace check (reference_no like 'NIASN-N-%')
);

create unique index if not exists store_order_payments_reference_uq
  on public.store_order_payments (reference_no);
-- One capture per gateway transaction: the idempotency backstop for a retried
-- or duplicated callback that arrives with the same ICICI reference.
create unique index if not exists store_order_payments_gateway_ref_uq
  on public.store_order_payments (gateway_ref)
  where gateway_ref is not null and gateway_ref <> '';
create index if not exists store_order_payments_due_idx
  on public.store_order_payments (next_verify_at)
  where status in ('INITIATED', 'UNCONFIRMED', 'VERIFYING');
create index if not exists store_order_payments_order_idx
  on public.store_order_payments (order_id);

-- Every callback and verify response is persisted BEFORE interpretation.
create table if not exists public.store_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'ICICI_EAZYPAY',
  -- Dedupe key for a replayed callback. Composed by the store route.
  event_id text,
  event_type text not null,
  reference_no text,
  signature_ok boolean,
  -- True when a store reference was seen somewhere it should not have been.
  misrouted boolean not null default false,
  raw_json jsonb,
  processing_result text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists store_payment_events_event_uq
  on public.store_payment_events (event_id) where event_id is not null;
create index if not exists store_payment_events_ref_idx
  on public.store_payment_events (reference_no, created_at desc);

-- ------------------------------------------------------------------ shipments
-- Phase 1 fulfils manually (courier + AWB typed in). Phase 2 fills the same
-- rows through the ShippingProvider interface, so no migration is needed then.
create table if not exists public.store_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders (id) on delete cascade,
  provider text not null default 'manual',
  provider_shipment_id text,
  courier_id text,
  courier_name text,
  awb text,
  tracking_url text,
  label_r2_key text,
  manifest_r2_key text,
  status text not null default 'pending' check (status in (
    'pending', 'created', 'failed', 'cancelled',
    'manifested', 'picked_up', 'in_transit', 'out_for_delivery',
    'delivered', 'delivery_failed', 'rto', 'lost', 'damaged'
  )),
  weight_grams integer,
  length_mm integer,
  width_mm integer,
  height_mm integer,
  zone text,
  charge_paise integer,
  attempt_count integer not null default 0,
  last_error text,
  next_attempt_at timestamptz,
  pickup_scheduled_at timestamptz,
  picked_up_at timestamptz,
  expected_delivery_date date,
  delivered_at timestamptz,
  last_synced_at timestamptz,
  provider_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists store_shipments_awb_uq
  on public.store_shipments (awb) where awb is not null and awb <> '';
create index if not exists store_shipments_order_idx
  on public.store_shipments (order_id);
create index if not exists store_shipments_retry_idx
  on public.store_shipments (next_attempt_at)
  where status in ('pending', 'failed');

create table if not exists public.store_shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.store_shipments (id) on delete cascade,
  provider_status_raw text,
  mapped_status text,
  occurred_at timestamptz not null default now(),
  location text,
  remark text,
  payload_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists store_shipment_events_shipment_idx
  on public.store_shipment_events (shipment_id, occurred_at desc);

-- -------------------------------------------------------- serviceability / ETA
-- Zone transit table drives the promised date. Deliberately conservative: the
-- Phase 1 promise adds a further buffer on top of transit_days_max.
create table if not exists public.store_zones (
  id uuid primary key default gen_random_uuid(),
  -- Matched by longest pincode prefix; '' is the national fallback row.
  pincode_prefix text not null,
  zone text not null,
  label text,
  transit_days_min integer not null default 3,
  transit_days_max integer not null default 7,
  shipping_paise integer not null default 0,
  free_above_paise integer,
  serviceable boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists store_zones_prefix_uq
  on public.store_zones (pincode_prefix);

-- Cache for pincode → city/state/serviceability lookups so checkout never
-- depends on a third party being up.
create table if not exists public.store_pincode_cache (
  pincode text primary key,
  city text,
  district text,
  state text,
  serviceable boolean not null default true,
  source text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);

-- -------------------------------------------------------------------- reviews
-- Phase 4 surface, but the schema-level guarantee exists from day one: a review
-- REQUIRES a delivered order item and there can only ever be one per item.
-- There is no admin "add review" path, by construction.
create table if not exists public.store_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.store_products (id) on delete cascade,
  order_item_id uuid not null unique
    references public.store_order_items (id) on delete restrict,
  customer_id uuid references public.store_customers (id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  title text,
  body text,
  photo_r2_keys jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'published', 'hidden')),
  admin_reply text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists store_reviews_product_idx
  on public.store_reviews (product_id, status, published_at desc);

-- ------------------------------------------------------------- order numbering
-- Same mechanism as next_receipt_no() (supabase/schema.sql:522-536): a sequence
-- plus lpad inside a plpgsql function, so it is collision-safe under
-- concurrency and never exposes a database id. Continuous from 1001 — no
-- per-year reset, because a per-year counter row serialises every insert and
-- makes support ambiguous, while the year in the string still says when.
create sequence if not exists public.store_order_no_seq start 1001;

create or replace function public.next_store_order_no() returns text
language plpgsql as $$
declare
  n bigint;
  y text;
begin
  n := nextval('public.store_order_no_seq');
  y := to_char(now() at time zone 'Asia/Kolkata', 'YYYY');
  return 'NIAS-N-' || y || '-' || lpad(n::text, 6, '0');
end;
$$;

-- ------------------------------------------------------- paid-downgrade guard
-- Mirrors the course ledger's integrity trigger in PATTERN only (see
-- 2026-08-02-payment-outcome-integrity.sql). A captured store payment is
-- immutable in the ways that matter: it cannot be un-captured, its amount
-- cannot change, and its gateway reference cannot be rewritten.
create or replace function public.store_prevent_paid_downgrade() returns trigger
language plpgsql as $$
begin
  if old.status = 'CAPTURED' then
    if new.status not in ('CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED') then
      raise exception
        'store_order_payments: cannot move a CAPTURED payment to % (id=%)', new.status, old.id;
    end if;
    if new.amount_paise <> old.amount_paise then
      raise exception
        'store_order_payments: cannot change the amount of a CAPTURED payment (id=%)', old.id;
    end if;
    if old.gateway_ref is not null and new.gateway_ref is distinct from old.gateway_ref then
      raise exception
        'store_order_payments: cannot rewrite the gateway reference of a CAPTURED payment (id=%)', old.id;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_store_payments_prevent_paid_downgrade on public.store_order_payments;
create trigger trg_store_payments_prevent_paid_downgrade
  before update on public.store_order_payments
  for each row execute function public.store_prevent_paid_downgrade();

-- ------------------------------------------------------------------------ RLS
-- Enabled with no policies: server-side service-role access only, matching the
-- academy tables. The anon key can read nothing here.
alter table public.store_categories            enable row level security;
alter table public.store_products              enable row level security;
alter table public.store_bundle_items          enable row level security;
alter table public.store_product_media         enable row level security;
alter table public.store_stock_ledger          enable row level security;
alter table public.store_inventory_reservations enable row level security;
alter table public.store_customers             enable row level security;
alter table public.store_addresses             enable row level security;
alter table public.store_carts                 enable row level security;
alter table public.store_cart_items            enable row level security;
alter table public.store_orders                enable row level security;
alter table public.store_order_items           enable row level security;
alter table public.store_order_events          enable row level security;
alter table public.store_order_payments        enable row level security;
alter table public.store_payment_events        enable row level security;
alter table public.store_shipments             enable row level security;
alter table public.store_shipment_events       enable row level security;
alter table public.store_zones                 enable row level security;
alter table public.store_pincode_cache         enable row level security;
alter table public.store_reviews               enable row level security;

-- --------------------------------------------------------------- feature flags
-- §23, via the existing app_feature_flags table. The master switch ships
-- DISABLED: the store is dark from the first commit until it is turned on.
insert into public.app_feature_flags (key, enabled, scope, kill_switch, meta)
values
  ('notes_store',              false, 'off', false, '{"note":"master switch — one flag turns the entire store dark"}'::jsonb),
  ('notes_store_coupons',      false, 'off', false, '{"phase":4}'::jsonb),
  ('notes_store_free_shipping',false, 'off', false, '{"phase":4}'::jsonb),
  ('notes_store_reviews',      false, 'off', false, '{"phase":4}'::jsonb),
  ('notes_store_shiprocket',   false, 'off', false, '{"phase":2}'::jsonb),
  ('notes_store_sms',          false, 'off', false, '{"phase":1,"note":"blocked until DLT templates are approved"}'::jsonb),
  ('notes_store_qr_bonuses',   false, 'off', false, '{"phase":4}'::jsonb),
  ('notes_store_preorders',    false, 'off', false, '{"phase":"out of Phase 1 — schema only, untested"}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- zone seeding
-- Conservative national defaults so the delivery-date promise works on day one
-- from Chandigarh. Admin-editable; these are transit days, and the promise adds
-- dispatch_days plus the Phase 1 buffer on top.
insert into public.store_zones (pincode_prefix, zone, label, transit_days_min, transit_days_max, shipping_paise, position)
values
  ('',   'national', 'Rest of India',            5, 9, 9900, 100),
  ('16', 'local',    'Chandigarh / Panchkula',   1, 2, 4900, 10),
  ('14', 'zone_a',   'Punjab',                   2, 3, 5900, 20),
  ('13', 'zone_a',   'Haryana',                  2, 3, 5900, 21),
  ('11', 'zone_a',   'Delhi NCR',                2, 4, 5900, 22),
  ('17', 'zone_a',   'Himachal Pradesh',         3, 5, 6900, 23),
  ('18', 'zone_a',   'Jammu & Kashmir',          4, 7, 7900, 24),
  ('19', 'zone_a',   'Jammu & Kashmir',          4, 7, 7900, 25),
  ('20', 'zone_b',   'Western Uttar Pradesh',    3, 5, 6900, 30),
  ('21', 'zone_b',   'Uttar Pradesh',            3, 6, 6900, 31),
  ('22', 'zone_b',   'Uttar Pradesh',            3, 6, 6900, 32),
  ('30', 'zone_b',   'Rajasthan',                3, 6, 6900, 33),
  ('40', 'zone_c',   'Maharashtra',              4, 7, 7900, 40),
  ('56', 'zone_c',   'Karnataka',                4, 8, 7900, 41),
  ('60', 'zone_c',   'Tamil Nadu',               4, 8, 7900, 42),
  ('50', 'zone_c',   'Telangana',                4, 8, 7900, 43),
  ('70', 'zone_c',   'West Bengal',              4, 8, 7900, 44),
  ('78', 'zone_d',   'Assam / North East',       6, 10, 9900, 50),
  ('79', 'zone_d',   'North East',               6, 10, 9900, 51),
  ('73', 'zone_d',   'Andaman & Nicobar',        8, 14, 12900, 52)
on conflict (pincode_prefix) do nothing;
