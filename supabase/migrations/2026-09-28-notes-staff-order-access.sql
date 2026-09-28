-- Notes Store staff access.
-- Idempotent permission overrides for three existing accounts.
-- Does not change roles, passwords, customers, orders, or payments.
--
-- Apply with the release that keeps Notes analytics Super Admin only.
-- Do not apply while an older release (analytics gated by store_manage_orders)
-- is still serving traffic.

-- Anil Kumar: read orders and checkout leads. No order mutations.
update public.admin_users
set permissions_override =
  coalesce(permissions_override, '{}'::jsonb)
  || jsonb_build_object('store_view_orders', true, 'store_manage_orders', false)
where id = '68493d21-9821-47b8-96e5-9fefeb560d53'
  and username = 'anil_kumar'
  and role_id = 'finance';

-- Abhishek Prajapati: read and operate Notes orders. Checkout leads stay view-only in the app.
update public.admin_users
set permissions_override =
  coalesce(permissions_override, '{}'::jsonb)
  || jsonb_build_object('store_view_orders', true, 'store_manage_orders', true)
where id = 'af73fc8d-a0f8-43bf-b8f3-1abc7ad60639'
  and username = 'abhishek_prajapati'
  and phone = '7508353527'
  and role_id = 'admin';

-- Suraj Singh: same operational Notes access as Abhishek.
update public.admin_users
set permissions_override =
  coalesce(permissions_override, '{}'::jsonb)
  || jsonb_build_object('store_view_orders', true, 'store_manage_orders', true)
where id = 'ea2b40b1-9350-4014-b465-7e302c47189a'
  and username = 'suraj_singh'
  and role_id = 'admin';
