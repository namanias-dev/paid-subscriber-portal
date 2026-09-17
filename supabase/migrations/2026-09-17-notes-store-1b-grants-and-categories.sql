-- RPCs must not be callable with the anon key. Tables already have RLS with no
-- policies; functions default to GRANT EXECUTE ON ... TO PUBLIC in Postgres.
revoke all on function public.store_reserve_stock(jsonb, uuid, uuid, integer) from public;
revoke all on function public.store_release_reservations(uuid, uuid, text) from public;
revoke all on function public.store_commit_reservations(uuid) from public;
revoke all on function public.store_release_expired_reservations() from public;
revoke all on function public.next_store_order_no() from public;

grant execute on function public.store_reserve_stock(jsonb, uuid, uuid, integer) to service_role;
grant execute on function public.store_release_reservations(uuid, uuid, text) to service_role;
grant execute on function public.store_commit_reservations(uuid) to service_role;
grant execute on function public.store_release_expired_reservations() to service_role;
grant execute on function public.next_store_order_no() to service_role;

-- Subject taxonomy. Empty categories, not fake products.
insert into public.store_categories (slug, name, nav_label, short_description, position, is_active)
values
  ('polity', 'Polity', 'Polity', 'Constitution, governance, rights.', 10, true),
  ('modern-history', 'Modern History', 'Modern History', 'The freedom struggle, for the paper.', 20, true),
  ('ancient-history', 'Ancient & Medieval History', 'Ancient History', 'Culture and polity of the period.', 30, true),
  ('geography', 'Geography', 'Geography', 'Physical, Indian, human.', 40, true),
  ('economy', 'Economy', 'Economy', 'Indian economy, for prelims and mains.', 50, true),
  ('environment', 'Environment', 'Environment', 'Ecology, climate, biodiversity.', 60, true),
  ('ethics', 'Ethics', 'Ethics', 'GS-IV, cases and thinkers.', 70, true),
  ('current-affairs', 'Current Affairs compilations', 'CA Compilations', 'Printed compilations — not the daily desk.', 80, true),
  ('optionals', 'Optionals', 'Optionals', 'Selected optional notes.', 90, true)
on conflict (slug) do nothing;
