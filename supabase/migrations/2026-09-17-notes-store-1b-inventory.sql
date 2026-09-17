-- ============================================================================
-- Notes Store — Phase 1B. Inventory reservation, atomically.
--
-- Print-on-demand semantics: RESERVE on payment confirmation, DEDUCT on ship.
-- Between those two moments the stock is spoken for but still physically here,
-- which is what `reserved` means and why on_hand is not touched until dispatch.
--
-- Concurrency: each product row is locked with plain FOR UPDATE, not
-- FOR UPDATE SKIP LOCKED. SKIP LOCKED is right for claiming queue jobs, where
-- skipping a busy row means "someone else has it". It is wrong for stock, where
-- skipping a busy row would report a false out-of-stock to a customer who could
-- in fact have been served a moment later. Waiting for the lock is correct here;
-- the wait is microseconds and the answer is always true.
--
-- Everything runs inside the function's own transaction, so a partially reserved
-- multi-item cart is impossible: either every line is reserved or none is.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ------------------------------------------------------------------- reserve
-- p_items: [{"product_id": "...", "qty": 2}, ...]
-- Returns {"ok": true, "reservation_ids": [...]} or
--         {"ok": false, "shortfalls": [{"product_id", "name", "requested", "available"}]}
create or replace function public.store_reserve_stock(
  p_items jsonb,
  p_cart_id uuid default null,
  p_order_id uuid default null,
  p_ttl_seconds integer default 900
) returns jsonb
language plpgsql as $$
declare
  item record;
  prod record;
  available integer;
  shortfalls jsonb := '[]'::jsonb;
  reservation_ids jsonb := '[]'::jsonb;
  new_id uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no items');
  end if;

  -- Pass 1: lock every product in a stable order and check availability. A
  -- consistent lock order (by id) is what stops two concurrent multi-item carts
  -- deadlocking against each other.
  for item in
    select (e->>'product_id')::uuid as product_id, greatest(1, coalesce((e->>'qty')::int, 1)) as qty
    from jsonb_array_elements(p_items) e
    order by (e->>'product_id')::uuid
  loop
    select id, name, on_hand, reserved, allow_backorder, is_active, max_quantity_per_order
      into prod
    from public.store_products
    where id = item.product_id
    for update;

    if not found then
      shortfalls := shortfalls || jsonb_build_object(
        'product_id', item.product_id, 'name', null, 'requested', item.qty, 'available', 0, 'reason', 'not found');
      continue;
    end if;

    if not prod.is_active then
      shortfalls := shortfalls || jsonb_build_object(
        'product_id', prod.id, 'name', prod.name, 'requested', item.qty, 'available', 0, 'reason', 'inactive');
      continue;
    end if;

    if item.qty > prod.max_quantity_per_order then
      shortfalls := shortfalls || jsonb_build_object(
        'product_id', prod.id, 'name', prod.name, 'requested', item.qty,
        'available', prod.max_quantity_per_order, 'reason', 'per-order limit');
      continue;
    end if;

    available := prod.on_hand - prod.reserved;
    if available < item.qty and not prod.allow_backorder then
      shortfalls := shortfalls || jsonb_build_object(
        'product_id', prod.id, 'name', prod.name, 'requested', item.qty,
        'available', greatest(0, available), 'reason', 'insufficient stock');
    end if;
  end loop;

  -- Any shortfall fails the whole cart. A half-reserved order is worse than a
  -- clear "this one is out of stock".
  if jsonb_array_length(shortfalls) > 0 then
    return jsonb_build_object('ok', false, 'shortfalls', shortfalls);
  end if;

  -- Pass 2: commit the reservations. Still inside the same transaction and still
  -- holding the row locks taken above.
  for item in
    select (e->>'product_id')::uuid as product_id, greatest(1, coalesce((e->>'qty')::int, 1)) as qty
    from jsonb_array_elements(p_items) e
    order by (e->>'product_id')::uuid
  loop
    update public.store_products
    set reserved = reserved + item.qty, updated_at = now()
    where id = item.product_id;

    insert into public.store_inventory_reservations (product_id, cart_id, order_id, qty, expires_at)
    values (item.product_id, p_cart_id, p_order_id,
            item.qty, now() + make_interval(secs => greatest(60, p_ttl_seconds)))
    returning id into new_id;

    reservation_ids := reservation_ids || to_jsonb(new_id);

    insert into public.store_stock_ledger (product_id, delta, reason, ref_type, ref_id)
    values (item.product_id, -item.qty, 'reserve',
            case when p_order_id is not null then 'order' else 'cart' end,
            coalesce(p_order_id, p_cart_id)::text);
  end loop;

  return jsonb_build_object('ok', true, 'reservation_ids', reservation_ids);
end;
$$;

-- ------------------------------------------------------------------- release
-- Give stock back: a failed payment, an expired checkout, a cancelled order.
-- Conditional on the reservation still being open, so releasing twice is a no-op
-- rather than a stock inflation bug.
create or replace function public.store_release_reservations(
  p_order_id uuid default null,
  p_cart_id uuid default null,
  p_reason text default 'release'
) returns integer
language plpgsql as $$
declare
  r record;
  released integer := 0;
begin
  for r in
    select id, product_id, qty
    from public.store_inventory_reservations
    where released_at is null and committed_at is null
      and ((p_order_id is not null and order_id = p_order_id)
        or (p_cart_id is not null and cart_id = p_cart_id))
    order by product_id
    for update
  loop
    update public.store_products
    set reserved = greatest(0, reserved - r.qty), updated_at = now()
    where id = r.product_id;

    update public.store_inventory_reservations
    set released_at = now()
    where id = r.id and released_at is null and committed_at is null;

    insert into public.store_stock_ledger (product_id, delta, reason, ref_type, ref_id)
    values (r.product_id, r.qty, 'release', case when p_order_id is not null then 'order' else 'cart' end,
            coalesce(p_order_id, p_cart_id)::text);

    released := released + 1;
  end loop;
  return released;
end;
$$;

-- -------------------------------------------------------------------- commit
-- Dispatch: the books physically leave. on_hand falls, the reservation closes.
create or replace function public.store_commit_reservations(p_order_id uuid)
returns integer
language plpgsql as $$
declare
  r record;
  committed integer := 0;
begin
  for r in
    select id, product_id, qty
    from public.store_inventory_reservations
    where order_id = p_order_id and released_at is null and committed_at is null
    order by product_id
    for update
  loop
    update public.store_products
    set on_hand = greatest(0, on_hand - r.qty),
        reserved = greatest(0, reserved - r.qty),
        updated_at = now()
    where id = r.product_id;

    update public.store_inventory_reservations
    set committed_at = now()
    where id = r.id and released_at is null and committed_at is null;

    insert into public.store_stock_ledger (product_id, delta, reason, ref_type, ref_id)
    values (r.product_id, 0, 'commit', 'order', p_order_id::text);

    committed := committed + 1;
  end loop;
  return committed;
end;
$$;

-- --------------------------------------------------------- expiry sweep
-- An abandoned checkout must not hold stock for ever. Called by the store cron.
create or replace function public.store_release_expired_reservations()
returns integer
language plpgsql as $$
declare
  r record;
  released integer := 0;
begin
  for r in
    select id, product_id, qty
    from public.store_inventory_reservations
    where released_at is null and committed_at is null and expires_at < now()
    order by product_id
    for update skip locked
    limit 500
  loop
    update public.store_products
    set reserved = greatest(0, reserved - r.qty), updated_at = now()
    where id = r.product_id;

    update public.store_inventory_reservations set released_at = now() where id = r.id;

    insert into public.store_stock_ledger (product_id, delta, reason, ref_type, ref_id)
    values (r.product_id, r.qty, 'release', 'expiry', r.id::text);

    released := released + 1;
  end loop;
  return released;
end;
$$;
