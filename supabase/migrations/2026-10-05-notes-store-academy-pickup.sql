-- Academy Pickup: a second, order-level fulfilment method beside courier delivery.
-- Additive. Historical orders become DELIVERY through the column default (no rewrite).
-- Customer location for pickup is an order snapshot; store_addresses is unchanged.
-- Service role only (RLS stays on, no policies), same as the rest of the store.

begin;

-- ------------------------------------------------------------------ orders
alter table public.store_orders
  add column if not exists fulfillment_method text not null default 'DELIVERY',
  add column if not exists pickup_location_code text,
  add column if not exists pickup_location_snapshot jsonb,
  add column if not exists pickup_acknowledged_at timestamptz,
  add column if not exists customer_location_snapshot jsonb,
  add column if not exists ready_for_collection_at timestamptz,
  add column if not exists collected_at timestamptz;

alter table public.store_orders drop constraint if exists store_orders_fulfillment_method_check;
alter table public.store_orders add constraint store_orders_fulfillment_method_check
  check (fulfillment_method in ('DELIVERY', 'ACADEMY_PICKUP'));

-- Widen the status list: every existing value stays, two collection statuses are added.
alter table public.store_orders drop constraint if exists store_orders_status_check;
alter table public.store_orders add constraint store_orders_status_check check (status in (
  'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED',
  'PAYMENT_CONFIRMED', 'ORDER_CONFIRMED', 'PROCESSING', 'PRINTING',
  'QUALITY_CHECK', 'READY_TO_PACK', 'PACKED', 'READY_FOR_PICKUP',
  'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY',
  'DELIVERED', 'DELIVERY_FAILED', 'REATTEMPT_REQUESTED',
  'RTO_INITIATED', 'RTO_IN_TRANSIT', 'RTO_DELIVERED',
  'CANCEL_REQUESTED', 'CANCELLED',
  'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_PICKUP_SCHEDULED',
  'RETURN_IN_TRANSIT', 'RETURN_RECEIVED',
  'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED',
  'READY_FOR_COLLECTION', 'COLLECTED'
));

-- Courier-only statuses never apply to pickup; collection statuses never apply to delivery.
-- Shared statuses (payment, preparation, cancel, refund, return request/approval/receipt) apply to both.
alter table public.store_orders drop constraint if exists store_orders_status_method_check;
alter table public.store_orders add constraint store_orders_status_method_check check (
  (fulfillment_method = 'DELIVERY' and status not in ('READY_FOR_COLLECTION', 'COLLECTED'))
  or
  (fulfillment_method = 'ACADEMY_PICKUP' and status not in (
    'PACKED', 'READY_FOR_PICKUP', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT',
    'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'REATTEMPT_REQUESTED',
    'RTO_INITIATED', 'RTO_IN_TRANSIT', 'RTO_DELIVERED',
    'RETURN_PICKUP_SCHEDULED', 'RETURN_IN_TRANSIT'
  ))
) not valid;
alter table public.store_orders validate constraint store_orders_status_method_check;

-- A pickup order has no courier destination, no shipping charge, and a frozen promise.
alter table public.store_orders drop constraint if exists store_orders_pickup_shape_check;
alter table public.store_orders add constraint store_orders_pickup_shape_check check (
  fulfillment_method <> 'ACADEMY_PICKUP' or (
    shipping_paise = 0
    and shipping_address_id is null
    and pickup_location_code is not null
    and pickup_location_snapshot is not null
    and pickup_acknowledged_at is not null
    and customer_location_snapshot is not null
  )
) not valid;
alter table public.store_orders validate constraint store_orders_pickup_shape_check;

-- Delivery orders never carry pickup metadata.
alter table public.store_orders drop constraint if exists store_orders_delivery_shape_check;
alter table public.store_orders add constraint store_orders_delivery_shape_check check (
  fulfillment_method <> 'DELIVERY' or (
    pickup_location_code is null
    and pickup_location_snapshot is null
    and pickup_acknowledged_at is null
    and ready_for_collection_at is null
    and collected_at is null
  )
) not valid;
alter table public.store_orders validate constraint store_orders_delivery_shape_check;

-- Collection statuses carry their timestamps.
alter table public.store_orders drop constraint if exists store_orders_collection_times_check;
alter table public.store_orders add constraint store_orders_collection_times_check check (
  (status <> 'READY_FOR_COLLECTION' or ready_for_collection_at is not null)
  and (status <> 'COLLECTED' or (ready_for_collection_at is not null and collected_at is not null))
) not valid;
alter table public.store_orders validate constraint store_orders_collection_times_check;

-- Method and the accepted pickup promise are fixed when the order is created.
create or replace function public.store_orders_freeze_fulfillment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.fulfillment_method is distinct from old.fulfillment_method
     or new.pickup_location_code is distinct from old.pickup_location_code
     or new.pickup_location_snapshot is distinct from old.pickup_location_snapshot
     or new.pickup_acknowledged_at is distinct from old.pickup_acknowledged_at
     or new.customer_location_snapshot is distinct from old.customer_location_snapshot then
    raise exception 'store_orders: fulfilment method and pickup snapshot are immutable (order %)', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.store_orders_freeze_fulfillment() from public, anon, authenticated;

drop trigger if exists trg_store_orders_freeze_fulfillment on public.store_orders;
create trigger trg_store_orders_freeze_fulfillment
  before update of fulfillment_method, pickup_location_code, pickup_location_snapshot,
    pickup_acknowledged_at, customer_location_snapshot
  on public.store_orders
  for each row execute function public.store_orders_freeze_fulfillment();

create index if not exists store_orders_pickup_queue_idx
  on public.store_orders (status, ready_for_collection_at)
  where fulfillment_method = 'ACADEMY_PICKUP';

-- ------------------------------------------------------------------ courier backstop
-- No courier record may ever reference an Academy Pickup order, on insert or re-link.
create or replace function public.store_courier_delivery_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.store_orders o
    where o.id = new.order_id and o.fulfillment_method = 'ACADEMY_PICKUP'
  ) then
    raise exception 'store: Academy Pickup order % cannot have % rows', new.order_id, tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.store_courier_delivery_only() from public, anon, authenticated;

drop trigger if exists trg_store_shipments_delivery_only on public.store_shipments;
create trigger trg_store_shipments_delivery_only
  before insert or update of order_id on public.store_shipments
  for each row execute function public.store_courier_delivery_only();

drop trigger if exists trg_store_courier_quote_sessions_delivery_only on public.store_courier_quote_sessions;
create trigger trg_store_courier_quote_sessions_delivery_only
  before insert or update of order_id on public.store_courier_quote_sessions
  for each row execute function public.store_courier_delivery_only();

drop trigger if exists trg_store_courier_quote_options_delivery_only on public.store_courier_quote_options;
create trigger trg_store_courier_quote_options_delivery_only
  before insert or update of order_id on public.store_courier_quote_options
  for each row execute function public.store_courier_delivery_only();

drop trigger if exists trg_store_courier_booking_attempts_delivery_only on public.store_courier_booking_attempts;
create trigger trg_store_courier_booking_attempts_delivery_only
  before insert or update of order_id on public.store_courier_booking_attempts
  for each row execute function public.store_courier_delivery_only();

-- ------------------------------------------------------------------ customer issues
-- Pickup customers report collection problems, not courier ones. Widen the category list.
alter table public.store_order_issues drop constraint if exists store_order_issues_category_check;
alter table public.store_order_issues add constraint store_order_issues_category_check check (category in (
  'ADDRESS_ISSUE', 'DELIVERY_DELAY', 'PICKUP_ISSUE', 'TRACKING_ISSUE', 'STATUS_MISMATCH',
  'DAMAGE_ISSUE', 'UPDATE_REQUEST', 'OTHER',
  'NOT_READY_YET', 'CANNOT_COLLECT', 'MISSING_OR_WRONG', 'INVOICE_PAYMENT'
));

-- ------------------------------------------------------------------ cart + leads
alter table public.store_carts add column if not exists fulfillment_method text;
alter table public.store_carts drop constraint if exists store_carts_fulfillment_method_check;
alter table public.store_carts add constraint store_carts_fulfillment_method_check
  check (fulfillment_method is null or fulfillment_method in ('DELIVERY', 'ACADEMY_PICKUP'));

alter table public.store_checkout_leads add column if not exists fulfillment_method text;
alter table public.store_checkout_leads drop constraint if exists store_checkout_leads_fulfillment_method_check;
alter table public.store_checkout_leads add constraint store_checkout_leads_fulfillment_method_check
  check (fulfillment_method is null or fulfillment_method in ('DELIVERY', 'ACADEMY_PICKUP'));

-- ------------------------------------------------------------------ flag (off)
insert into public.app_feature_flags (key, enabled, scope, kill_switch, meta)
values ('notes_store_academy_pickup', false, 'off', false, '{}'::jsonb)
on conflict (key) do nothing;

commit;
