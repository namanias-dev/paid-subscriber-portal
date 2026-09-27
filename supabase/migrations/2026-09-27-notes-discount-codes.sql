-- Additive Notes discount codes. Existing price, order, and payment columns
-- are not rewritten. Historical orders keep the amounts they were captured at.
-- notes_store_coupons is the emergency switch: off hides checkout entry.

create table if not exists public.store_discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  discount_type text not null check (discount_type in ('fixed_amount', 'percentage')),
  discount_value integer not null check (discount_value > 0),
  scope text not null check (scope in ('all_notes', 'selected_products')),
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default false,
  archived_at timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions >= 1),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  per_customer_limit integer check (per_customer_limit is null or per_customer_limit >= 1),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists store_discount_codes_code_uq
  on public.store_discount_codes (code);

create index if not exists store_discount_codes_active_idx
  on public.store_discount_codes (is_active, expires_at);

create table if not exists public.store_discount_code_products (
  discount_code_id uuid not null references public.store_discount_codes (id) on delete cascade,
  product_id uuid not null references public.store_products (id) on delete restrict,
  primary key (discount_code_id, product_id)
);

create table if not exists public.store_discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references public.store_discount_codes (id) on delete restrict,
  order_id uuid not null references public.store_orders (id) on delete cascade,
  phone_hash text,
  discount_amount_paise integer not null check (discount_amount_paise >= 0),
  status text not null check (status in ('held', 'captured', 'released')),
  expires_at timestamptz,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id)
);

create index if not exists store_discount_redemptions_code_status_idx
  on public.store_discount_redemptions (discount_code_id, status);

create index if not exists store_discount_redemptions_phone_idx
  on public.store_discount_redemptions (discount_code_id, phone_hash)
  where phone_hash is not null and status in ('held', 'captured');

create table if not exists public.store_discount_code_events (
  id uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references public.store_discount_codes (id) on delete cascade,
  event text not null,
  actor text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists store_discount_code_events_idx
  on public.store_discount_code_events (discount_code_id, created_at desc);

alter table public.store_orders add column if not exists coupon_code text;
alter table public.store_orders add column if not exists coupon_id uuid;
alter table public.store_orders add column if not exists coupon_discount_paise integer not null default 0;
alter table public.store_orders add column if not exists coupon_snapshot jsonb;

create index if not exists store_orders_coupon_code_idx
  on public.store_orders (coupon_code)
  where coupon_code is not null;

alter table public.store_checkout_leads add column if not exists coupon_code text;
alter table public.store_checkout_leads add column if not exists coupon_discount_paise integer not null default 0;
alter table public.store_checkout_leads add column if not exists cart_before_discount_paise integer;
alter table public.store_checkout_leads add column if not exists cart_after_discount_paise integer;

alter table public.store_discount_codes enable row level security;
alter table public.store_discount_code_products enable row level security;
alter table public.store_discount_redemptions enable row level security;
alter table public.store_discount_code_events enable row level security;

revoke all on public.store_discount_codes from public, anon, authenticated;
revoke all on public.store_discount_code_products from public, anon, authenticated;
revoke all on public.store_discount_redemptions from public, anon, authenticated;
revoke all on public.store_discount_code_events from public, anon, authenticated;

-- Reserve one slot at payment start. Concurrent checkouts lock the code row.
-- Capture later does not re-check expiry: an in-flight payment keeps its snapshot.
create or replace function public.store_hold_discount_code(
  p_code_id uuid,
  p_order_id uuid,
  p_phone_hash text,
  p_amount integer,
  p_ttl_seconds integer default 900
)
returns jsonb
language plpgsql
as $$
declare
  rec public.store_discount_codes%rowtype;
  existing public.store_discount_redemptions%rowtype;
  held_count integer;
  customer_count integer;
  now_ts timestamptz := clock_timestamp();
  ttl integer := greatest(60, coalesce(p_ttl_seconds, 900));
begin
  if p_code_id is null or p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  select * into existing
    from public.store_discount_redemptions
   where order_id = p_order_id
   for update;

  if found and existing.status = 'captured' then
    return jsonb_build_object('ok', true, 'already', 'captured');
  end if;
  if found and existing.status = 'held' and existing.discount_code_id = p_code_id then
    return jsonb_build_object('ok', true, 'already', 'held');
  end if;

  select * into rec
    from public.store_discount_codes
   where id = p_code_id
   for update;

  if not found or rec.archived_at is not null or rec.is_active is not true then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if rec.starts_at is not null and rec.starts_at > now_ts then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if rec.expires_at is not null and rec.expires_at <= now_ts then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select count(*) into held_count
    from public.store_discount_redemptions
   where discount_code_id = p_code_id
     and status = 'held'
     and order_id <> p_order_id;

  if rec.max_redemptions is not null and (rec.redemption_count + held_count) >= rec.max_redemptions then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;

  if rec.per_customer_limit is not null and p_phone_hash is not null and length(p_phone_hash) > 0 then
    select count(*) into customer_count
      from public.store_discount_redemptions
     where discount_code_id = p_code_id
       and phone_hash = p_phone_hash
       and status in ('held', 'captured')
       and order_id <> p_order_id;
    if customer_count >= rec.per_customer_limit then
      return jsonb_build_object('ok', false, 'reason', 'customer_limit');
    end if;
  end if;

  insert into public.store_discount_redemptions (
    discount_code_id, order_id, phone_hash, discount_amount_paise, status, expires_at, updated_at
  )
  values (
    p_code_id, p_order_id, nullif(p_phone_hash, ''), greatest(0, coalesce(p_amount, 0)), 'held',
    now_ts + make_interval(secs => ttl), now_ts
  )
  on conflict (order_id) do update
    set discount_code_id = excluded.discount_code_id,
        phone_hash = excluded.phone_hash,
        discount_amount_paise = excluded.discount_amount_paise,
        status = 'held',
        expires_at = excluded.expires_at,
        redeemed_at = null,
        updated_at = now_ts
  where public.store_discount_redemptions.status <> 'captured';

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.store_capture_discount_code(p_order_id uuid)
returns jsonb
language plpgsql
as $$
declare
  existing public.store_discount_redemptions%rowtype;
  now_ts timestamptz := clock_timestamp();
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  select * into existing
    from public.store_discount_redemptions
   where order_id = p_order_id
   for update;

  if not found then
    return jsonb_build_object('ok', true, 'already', 'none');
  end if;
  if existing.status = 'captured' then
    return jsonb_build_object('ok', true, 'already', 'captured');
  end if;

  update public.store_discount_redemptions
     set status = 'captured',
         redeemed_at = now_ts,
         updated_at = now_ts
   where id = existing.id
     and status <> 'captured';

  update public.store_discount_codes
     set redemption_count = redemption_count + 1,
         updated_at = now_ts
   where id = existing.discount_code_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.store_release_discount_code(p_order_id uuid)
returns jsonb
language plpgsql
as $$
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  update public.store_discount_redemptions
     set status = 'released',
         updated_at = clock_timestamp()
   where order_id = p_order_id
     and status = 'held';
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.store_hold_discount_code(uuid, uuid, text, integer, integer) from public;
revoke all on function public.store_capture_discount_code(uuid) from public;
revoke all on function public.store_release_discount_code(uuid) from public;

grant execute on function public.store_hold_discount_code(uuid, uuid, text, integer, integer) to service_role;
grant execute on function public.store_capture_discount_code(uuid) to service_role;
grant execute on function public.store_release_discount_code(uuid) to service_role;

insert into public.app_feature_flags (key, enabled, scope, kill_switch, meta)
values (
  'notes_store_coupons',
  true,
  'all',
  false,
  '{"note":"checkout discount entry. kill_switch or enabled=false hides it without a deploy"}'::jsonb
)
on conflict (key) do update set
  enabled = true,
  scope = 'all',
  kill_switch = false,
  updated_at = now();
