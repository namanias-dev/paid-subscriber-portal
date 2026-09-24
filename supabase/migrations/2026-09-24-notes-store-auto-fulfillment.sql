-- Order-level lock so two Mark Packed clicks cannot book two shipments.
alter table public.store_orders
  add column if not exists fulfillment_lock_at timestamptz,
  add column if not exists fulfillment_state text,
  add column if not exists fulfillment_note text;

insert into public.app_feature_flags (key, enabled, scope, kill_switch, meta)
values (
  'notes_store_auto_fulfillment',
  false,
  'off',
  false,
  '{"strategy":"CHEAPEST_ELIGIBLE","max_attempts":3,"shiprocket":true,"delhivery":true,"excluded_carriers":[]}'::jsonb
)
on conflict (key) do nothing;
