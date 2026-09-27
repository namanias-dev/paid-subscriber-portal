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
  customer_id uuid,
  phone_hash text,
  customer_limit_key text,
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

-- One live payment reservation per customer per code. A second tab cannot take another slot.
create unique index if not exists store_discount_redemptions_one_live_hold_uq
  on public.store_discount_redemptions (discount_code_id, phone_hash)
  where status = 'held' and phone_hash is not null;

-- One successful redemption per customer when the code has a per-customer limit.
-- customer_limit_key is set only on capture, and only when that limit is on.
create unique index if not exists store_discount_redemptions_customer_capture_uq
  on public.store_discount_redemptions (discount_code_id, customer_limit_key)
  where status = 'captured' and customer_limit_key is not null;

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
-- Applying a code does not call this. Capture does not re-check expiry or
-- is_active: a reservation created before expiry or disable can still finish.
-- Default TTL is 30 minutes (ICICI can outlast the 15-minute quote lock).
-- The app clamps NOTES_DISCOUNT_HOLD_TTL_SECONDS to 15–60 minutes.
create or replace function public.store_hold_discount_code(
  p_code_id uuid,
  p_order_id uuid,
  p_phone_hash text,
  p_amount integer,
  p_ttl_seconds integer default 1800,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  rec public.store_discount_codes%rowtype;
  existing public.store_discount_redemptions%rowtype;
  held_count integer;
  customer_captured integer;
  now_ts timestamptz := clock_timestamp();
  ttl integer := case
    when p_ttl_seconds is null or p_ttl_seconds < 900 or p_ttl_seconds > 3600 then 1800
    else p_ttl_seconds
  end;
  phone text := nullif(p_phone_hash, '');
begin
  if p_code_id is null or p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  select * into existing
    from public.store_discount_redemptions
   where order_id = p_order_id
   for update;

  if found and existing.status = 'captured' then
    return jsonb_build_object('ok', true, 'already', 'captured', 'changed', false);
  end if;
  if found
     and existing.status = 'held'
     and existing.discount_code_id = p_code_id
     and (existing.expires_at is null or existing.expires_at > now_ts) then
    update public.store_discount_redemptions
       set expires_at = now_ts + make_interval(secs => ttl),
           updated_at = now_ts
     where id = existing.id
       and status = 'held';
    return jsonb_build_object('ok', true, 'already', 'held', 'changed', false);
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

  -- Expired reservations must not keep scarce slots. This runs under the code lock.
  update public.store_discount_redemptions
     set status = 'released',
         updated_at = now_ts
   where discount_code_id = p_code_id
     and status = 'held'
     and expires_at is not null
     and expires_at <= now_ts;

  if phone is not null then
    if exists (
      select 1
        from public.store_discount_redemptions
       where discount_code_id = p_code_id
         and phone_hash = phone
         and status = 'held'
         and order_id <> p_order_id
         and (expires_at is null or expires_at > now_ts)
    ) then
      return jsonb_build_object('ok', false, 'reason', 'customer_pending');
    end if;
  end if;

  if rec.per_customer_limit is not null and phone is not null then
    select count(*) into customer_captured
      from public.store_discount_redemptions
     where discount_code_id = p_code_id
       and phone_hash = phone
       and status = 'captured'
       and order_id <> p_order_id;
    if customer_captured >= rec.per_customer_limit then
      return jsonb_build_object('ok', false, 'reason', 'customer_limit');
    end if;
  end if;

  select count(*) into held_count
    from public.store_discount_redemptions
   where discount_code_id = p_code_id
     and status = 'held'
     and order_id <> p_order_id
     and (expires_at is null or expires_at > now_ts);

  if rec.max_redemptions is not null and (rec.redemption_count + held_count) >= rec.max_redemptions then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;

  begin
    insert into public.store_discount_redemptions (
      discount_code_id, order_id, customer_id, phone_hash, discount_amount_paise, status, expires_at, updated_at
    )
    values (
      p_code_id, p_order_id, p_customer_id, phone, greatest(0, coalesce(p_amount, 0)), 'held',
      now_ts + make_interval(secs => ttl), now_ts
    )
    on conflict (order_id) do update
      set discount_code_id = excluded.discount_code_id,
          customer_id = excluded.customer_id,
          phone_hash = excluded.phone_hash,
          discount_amount_paise = excluded.discount_amount_paise,
          status = 'held',
          expires_at = excluded.expires_at,
          redeemed_at = null,
          customer_limit_key = null,
          updated_at = now_ts
    where public.store_discount_redemptions.status <> 'captured';
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'customer_pending');
  end;

  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

create or replace function public.store_capture_discount_code(p_order_id uuid)
returns jsonb
language plpgsql
as $$
declare
  existing public.store_discount_redemptions%rowtype;
  rec public.store_discount_codes%rowtype;
  now_ts timestamptz := clock_timestamp();
  moved integer := 0;
  held_count integer := 0;
  customer_captured integer := 0;
  coupon text;
  limit_key text;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  select * into existing
    from public.store_discount_redemptions
   where order_id = p_order_id
   for update;

  if not found then
    return jsonb_build_object('ok', true, 'already', 'none', 'changed', false);
  end if;
  if existing.status = 'captured' then
    return jsonb_build_object('ok', true, 'already', 'captured', 'changed', false);
  end if;

  select * into rec
    from public.store_discount_codes
   where id = existing.discount_code_id
   for update;

  if not found then
    return jsonb_build_object('ok', true, 'already', 'none', 'changed', false);
  end if;

  coupon := rec.code;
  limit_key := case
    when rec.per_customer_limit is not null then existing.phone_hash
    else null
  end;

  -- A still-held row always converts, even if the clock passed expires_at or the
  -- code was disabled after Pay. The slot was already taken for this attempt.
  if existing.status = 'held' then
    if rec.per_customer_limit is not null and existing.phone_hash is not null then
      select count(*) into customer_captured
        from public.store_discount_redemptions
       where discount_code_id = existing.discount_code_id
         and phone_hash = existing.phone_hash
         and status = 'captured'
         and order_id <> p_order_id;
      if customer_captured >= rec.per_customer_limit then
        update public.store_discount_redemptions
           set status = 'released', updated_at = now_ts
         where id = existing.id and status = 'held';
        return jsonb_build_object('ok', true, 'changed', false, 'already', 'customer_limit', 'coupon_code', coupon);
      end if;
    end if;

    update public.store_discount_redemptions
       set status = 'captured',
           redeemed_at = now_ts,
           customer_limit_key = limit_key,
           updated_at = now_ts
     where id = existing.id
       and status = 'held';
    get diagnostics moved = row_count;
    if moved = 1 then
      update public.store_discount_codes
         set redemption_count = redemption_count + 1,
             updated_at = now_ts
       where id = existing.discount_code_id;
      return jsonb_build_object('ok', true, 'changed', true, 'coupon_code', coupon, 'discount_amount', existing.discount_amount_paise);
    end if;
    return jsonb_build_object('ok', true, 'already', 'captured', 'changed', false);
  end if;

  -- Released (TTL or failure) and a late capture arrived. Reacquire only while
  -- redeemed + other live holds are still under the cap. Never exceed it.
  -- Do not re-check coupon expiry or is_active.
  update public.store_discount_redemptions
     set status = 'released', updated_at = now_ts
   where discount_code_id = existing.discount_code_id
     and status = 'held'
     and expires_at is not null
     and expires_at <= now_ts
     and order_id <> p_order_id;

  if rec.per_customer_limit is not null and existing.phone_hash is not null then
    select count(*) into customer_captured
      from public.store_discount_redemptions
     where discount_code_id = existing.discount_code_id
       and phone_hash = existing.phone_hash
       and status = 'captured'
       and order_id <> p_order_id;
    if customer_captured >= rec.per_customer_limit then
      return jsonb_build_object('ok', true, 'changed', false, 'already', 'over_cap', 'coupon_code', coupon);
    end if;
  end if;

  select count(*) into held_count
    from public.store_discount_redemptions
   where discount_code_id = existing.discount_code_id
     and status = 'held'
     and order_id <> p_order_id
     and (expires_at is null or expires_at > now_ts);

  if rec.max_redemptions is not null and (rec.redemption_count + held_count) >= rec.max_redemptions then
    return jsonb_build_object('ok', true, 'changed', false, 'already', 'over_cap', 'coupon_code', coupon);
  end if;

  update public.store_discount_redemptions
     set status = 'captured',
         redeemed_at = now_ts,
         customer_limit_key = limit_key,
         updated_at = now_ts
   where id = existing.id
     and status = 'released';
  get diagnostics moved = row_count;
  if moved = 1 then
    update public.store_discount_codes
       set redemption_count = redemption_count + 1,
           updated_at = now_ts
     where id = existing.discount_code_id;
    return jsonb_build_object('ok', true, 'changed', true, 'coupon_code', coupon, 'discount_amount', existing.discount_amount_paise);
  end if;

  return jsonb_build_object('ok', true, 'changed', false, 'already', 'over_cap', 'coupon_code', coupon);
end;
$$;

create or replace function public.store_release_discount_code(p_order_id uuid)
returns jsonb
language plpgsql
as $$
declare
  existing public.store_discount_redemptions%rowtype;
  coupon text;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  select * into existing
    from public.store_discount_redemptions
   where order_id = p_order_id
     and status = 'held'
   for update;

  if not found then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update public.store_discount_redemptions
     set status = 'released',
         updated_at = clock_timestamp()
   where id = existing.id
     and status = 'held';

  select code into coupon
    from public.store_discount_codes
   where id = existing.discount_code_id;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'coupon_code', coupon,
    'discount_amount', existing.discount_amount_paise
  );
end;
$$;

create or replace function public.store_release_expired_discount_holds()
returns jsonb
language plpgsql
as $$
declare
  released_rows jsonb;
begin
  with gone as (
    update public.store_discount_redemptions
       set status = 'released',
           updated_at = clock_timestamp()
     where status = 'held'
       and expires_at is not null
       and expires_at <= clock_timestamp()
    returning order_id, discount_code_id, discount_amount_paise
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', gone.order_id,
    'discount_amount', gone.discount_amount_paise,
    'coupon_code', c.code
  )), '[]'::jsonb)
    into released_rows
    from gone
    join public.store_discount_codes c on c.id = gone.discount_code_id;

  return jsonb_build_object('ok', true, 'released', coalesce(released_rows, '[]'::jsonb));
end;
$$;

revoke all on function public.store_hold_discount_code(uuid, uuid, text, integer, integer, uuid) from public;
revoke all on function public.store_capture_discount_code(uuid) from public;
revoke all on function public.store_release_discount_code(uuid) from public;
revoke all on function public.store_release_expired_discount_holds() from public;

grant execute on function public.store_hold_discount_code(uuid, uuid, text, integer, integer, uuid) to service_role;
grant execute on function public.store_capture_discount_code(uuid) to service_role;
grant execute on function public.store_release_discount_code(uuid) to service_role;
grant execute on function public.store_release_expired_discount_holds() to service_role;

-- Stay off until production smoke. Do not override a later admin choice.
insert into public.app_feature_flags (key, enabled, scope, kill_switch, meta)
values (
  'notes_store_coupons',
  false,
  'all',
  false,
  '{"note":"checkout discount entry. inserted disabled. kill_switch or enabled=false hides it without a deploy"}'::jsonb
)
on conflict (key) do nothing;
