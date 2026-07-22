-- ⚠️ MANUAL — DO NOT AUTO-APPLY.
-- Full reversal of 2026-07-21-legacy-lead-import.sql. Run ONLY after the row-level rollback below
-- has removed every legacy-imported lead. Dropping the columns first would lose the ability to
-- identify which rows were legacy.
--
-- Row-level rollback (run FIRST):
--   delete from public.leads where id in (
--     select id from public.leads_backfill_snapshot where was_collision is false
--   );
--   update public.leads as l
--     set attribution = s.pre_state
--     from public.leads_backfill_snapshot s
--     where l.id = s.id and s.was_collision is true;
--
-- Only then execute the DDL below:
drop index if exists public.idx_leads_channel_legacy;
drop index if exists public.idx_leads_import_batch;
drop index if exists public.idx_leads_legacy_flag;

alter table public.leads
  drop column if exists first_seen_at,
  drop column if exists external_lead_id,
  drop column if exists import_batch,
  drop column if exists import_source,
  drop column if exists channel_legacy;

drop index if exists public.idx_leads_backfill_snapshot_batch;
drop table if exists public.leads_backfill_snapshot;

drop table if exists public.legacy_import_sync_state;
