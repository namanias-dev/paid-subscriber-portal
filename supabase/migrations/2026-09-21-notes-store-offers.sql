-- ============================================================================
-- Notes Store — limited-time offers + merchandised subject price.
--
-- Additive. Reversible. No academy payments/students/buyers tables.
-- Money remains INTEGER PAISE. Offer capacity is reserved at checkout
-- (store_offer_holds) and consumed only on a successful paid order.
-- ============================================================================

-- ----------------------------------------------------------------- offers
create table if not exists public.store_offers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  enabled boolean not null default false,
  discount_type text not null default 'percentage'
    check (discount_type in ('percentage', 'fixed_amount')),
  discount_value integer not null check (discount_value > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemptions_used integer not null default 0 check (redemptions_used >= 0),
  scope text not null default 'individual_subjects'
    check (scope in (
      'individual_subjects',
      'all_products',
      'specific_products',
      'specific_categories',
      'bundles'
    )),
  product_ids uuid[] not null default '{}',
  category_ids uuid[] not null default '{}',
  banner_title text,
  banner_subtitle text,
  badge_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_offers_window_ok check (
    ends_at is null or starts_at is null or ends_at > starts_at
  )
);

create index if not exists store_offers_live_idx
  on public.store_offers (enabled, starts_at, ends_at);

-- ----------------------------------------------------------------- holds
-- One hold per order. Held capacity counts against max_redemptions until
-- payment succeeds (consumed) or the reservation expires / payment fails
-- (released). Unique on order_id makes Verify consume idempotent.
create table if not exists public.store_offer_holds (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.store_offers (id) on delete cascade,
  order_id uuid not null references public.store_orders (id) on delete cascade,
  status text not null default 'held' check (status in ('held', 'consumed', 'released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id)
);

create index if not exists store_offer_holds_active_idx
  on public.store_offer_holds (offer_id, status)
  where status = 'held';

create index if not exists store_offer_holds_expiry_idx
  on public.store_offer_holds (expires_at)
  where status = 'held';

-- Optional join for admin order lists. Snapshot still lives on discount_trace_json.
alter table public.store_orders
  add column if not exists offer_id uuid references public.store_offers (id) on delete set null;

create index if not exists store_orders_offer_idx
  on public.store_orders (offer_id)
  where offer_id is not null;

alter table public.store_offers enable row level security;
alter table public.store_offer_holds enable row level security;

revoke all on table public.store_offers from public, anon, authenticated;
revoke all on table public.store_offer_holds from public, anon, authenticated;

-- -------------------------------------------------------- release expired
create or replace function public.store_release_expired_offer_holds()
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  update public.store_offer_holds
     set status = 'released',
         updated_at = clock_timestamp()
   where status = 'held'
     and expires_at <= clock_timestamp();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- -------------------------------------------------------------- hold
-- Lock the offer row, count used + live holds, then insert. Concurrent
-- checkouts at the last slot serialise on the offer row — only one wins.
create or replace function public.store_hold_offer(
  p_offer_id uuid,
  p_order_id uuid,
  p_ttl_seconds integer default 900
)
returns jsonb
language plpgsql
as $$
declare
  o record;
  held_count integer;
  now_ts timestamptz := clock_timestamp();
  existing record;
  ttl integer := greatest(30, coalesce(p_ttl_seconds, 900));
begin
  perform public.store_release_expired_offer_holds();

  if p_offer_id is null or p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing ids');
  end if;

  select * into existing
    from public.store_offer_holds
   where order_id = p_order_id
   for update;

  if found then
    if existing.status = 'consumed' then
      return jsonb_build_object('ok', true, 'already', 'consumed');
    end if;
    if existing.status = 'held' and existing.offer_id = p_offer_id then
      update public.store_offer_holds
         set expires_at = now_ts + make_interval(secs => ttl),
             updated_at = now_ts
       where id = existing.id;
      return jsonb_build_object('ok', true, 'already', 'held');
    end if;
    if existing.status = 'held' then
      return jsonb_build_object('ok', false, 'reason', 'order already holds another offer');
    end if;
  end if;

  select * into o
    from public.store_offers
   where id = p_offer_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'offer not found');
  end if;
  if not o.enabled then
    return jsonb_build_object('ok', false, 'reason', 'offer paused');
  end if;
  if o.starts_at is not null and o.starts_at > now_ts then
    return jsonb_build_object('ok', false, 'reason', 'offer not started');
  end if;
  if o.ends_at is not null and o.ends_at <= now_ts then
    return jsonb_build_object('ok', false, 'reason', 'offer ended');
  end if;

  select count(*) into held_count
    from public.store_offer_holds
   where offer_id = p_offer_id
     and status = 'held';

  if o.max_redemptions is not null
     and (o.redemptions_used + held_count) >= o.max_redemptions then
    return jsonb_build_object('ok', false, 'reason', 'offer cap reached');
  end if;

  insert into public.store_offer_holds (offer_id, order_id, status, expires_at)
  values (p_offer_id, p_order_id, 'held', now_ts + make_interval(secs => ttl))
  on conflict (order_id) do update
    set offer_id = excluded.offer_id,
        status = 'held',
        expires_at = excluded.expires_at,
        updated_at = now_ts
  where store_offer_holds.status = 'released';

  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------ consume
create or replace function public.store_consume_offer_hold(p_order_id uuid)
returns jsonb
language plpgsql
as $$
declare
  h record;
  updated integer;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  select * into h
    from public.store_offer_holds
   where order_id = p_order_id
   for update;

  if not found then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;
  if h.status = 'consumed' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if h.status <> 'held' then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  update public.store_offer_holds
     set status = 'consumed',
         updated_at = clock_timestamp()
   where id = h.id
     and status = 'held';
  get diagnostics updated = row_count;

  if updated = 1 then
    perform 1 from public.store_offers where id = h.offer_id for update;
    update public.store_offers
       set redemptions_used = redemptions_used + 1,
           updated_at = clock_timestamp()
     where id = h.offer_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------ release
create or replace function public.store_release_offer_hold(p_order_id uuid)
returns jsonb
language plpgsql
as $$
begin
  if p_order_id is null then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  update public.store_offer_holds
     set status = 'released',
         updated_at = clock_timestamp()
   where order_id = p_order_id
     and status = 'held';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.store_release_expired_offer_holds() from public;
revoke all on function public.store_hold_offer(uuid, uuid, integer) from public;
revoke all on function public.store_consume_offer_hold(uuid) from public;
revoke all on function public.store_release_offer_hold(uuid) from public;

grant execute on function public.store_release_expired_offer_holds() to service_role;
grant execute on function public.store_hold_offer(uuid, uuid, integer) to service_role;
grant execute on function public.store_consume_offer_hold(uuid) to service_role;
grant execute on function public.store_release_offer_hold(uuid) to service_role;

-- ---------------------------------------------- merchandised subject price
-- Canonical individual-subject selling price: ₹2,999 incl. GST (299900 paise).
-- Leave the ₹1 payment-test SKU and inactive QA rows untouched.
update public.store_products
   set selling_price_paise = 299900,
       mrp_paise = greatest(mrp_paise, 299900),
       updated_at = now()
 where sku in (
   'TEST-POLITY-RS',
   'TEST-ECONOMY-OD',
   'TEST-GEO-CS',
   'TEST-ETHICS-UN'
 );

-- Hide bundle merchandising without deleting bundle data or admin tools.
insert into public.app_feature_flags (key, enabled, scope, kill_switch, meta)
values (
  'notes_store_bundles',
  false,
  'off',
  false,
  '{"note":"storefront merchandising only — schema and admin remain"}'::jsonb
)
on conflict (key) do nothing;

-- Seed the first campaign. Every field is admin-editable after this insert.
insert into public.store_offers (
  name,
  slug,
  enabled,
  discount_type,
  discount_value,
  starts_at,
  ends_at,
  max_redemptions,
  redemptions_used,
  scope,
  banner_title,
  banner_subtitle,
  badge_text
)
select
  'Launch Offer',
  'launch-offer',
  true,
  'percentage',
  20,
  now(),
  now() + interval '7 days',
  100,
  0,
  'individual_subjects',
  'Limited-time launch offer',
  '20% off Naman Sir’s handwritten notes',
  '20% OFF'
where not exists (
  select 1 from public.store_offers where slug = 'launch-offer'
);
