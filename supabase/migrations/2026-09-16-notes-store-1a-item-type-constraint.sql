-- ============================================================================
-- Notes Store — Phase 1A. ISOLATION LAYER 2 of 4.
--
-- Pins public.payments.item_type to the academy's own money domain. A store
-- payment cannot enter the course ledger even if a future code path tries:
-- Postgres refuses the insert.
--
-- Why this carries more weight than originally planned: the store shares the
-- Eazypay merchant and the Eazypay return URL with courses. Reference-prefix
-- checks and route dispatch are code, and code can be edited by mistake. This
-- constraint is the layer that cannot be argued with, and it is the reason
-- getDashboard() (lib/dataProvider.ts:6728, which sums every paid row with no
-- item_type filter) can never see a notes order.
--
-- Verified safe against production data before writing this file: 2,429 rows,
-- item_type values {course: 851, webinar: 1578}, zero NULL or empty. So the
-- constraint validates immediately with no backfill and no NOT VALID step.
-- 'plan' is included because it is a legitimate academy item type even though
-- no row currently uses it.
--
-- Idempotent: safe to re-run.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_item_type_academy_only'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_item_type_academy_only
      check (item_type in ('course', 'webinar', 'plan'));
  end if;
end $$;
