-- =====================================================================
-- ROLLBACK for 2026-07-24-leads-jsonb-slimming.sql
--
-- REVERT THE APPLICATION CODE FIRST, then run the sections you need.
-- Every section is independent and idempotent; run only what you want to
-- undo. Sections are ordered so that running the whole file top-to-bottom
-- is also correct.
--
-- Nothing here deletes business data. The two restore sections rebuild
-- `attribution` keys from tables that were verified complete before the
-- originals were removed:
--   * `public.lead_legacy_touches`        178,312 rows, 0 mismatches
--   * `public.leads_jsonb_slim_snapshot`  178,183 rows
--
-- All restores are chunked and set-based. Do NOT rewrite 179k rows in a
-- single statement, and never row-by-row.
-- =====================================================================


-- ---------------------------------------------------------------------
-- R1. Put `legacy_touches[]` back into the blob (undoes item 1).
--     Only needed if something is restored that genuinely reads the key.
--     No product code path does.
-- ---------------------------------------------------------------------
-- do $$
-- declare v_chunk int := 10000; v_last text := ''; v_n int;
-- begin
--   loop
--     with src as (
--       select t.lead_id, t.touches from public.lead_legacy_touches t
--       where t.lead_id > v_last order by t.lead_id limit v_chunk
--     ), upd as (
--       update public.leads l
--          set attribution = coalesce(l.attribution, '{}'::jsonb)
--                            || jsonb_build_object('legacy_touches', src.touches)
--        from src where l.id = src.lead_id returning 1
--     )
--     select count(*), max(lead_id) into v_n, v_last from src;
--     exit when v_n = 0;
--     commit;
--   end loop;
-- end $$;


-- ---------------------------------------------------------------------
-- R2. Restore the three dropped dead keys (undoes item 4).
-- ---------------------------------------------------------------------
-- do $$
-- declare v_chunk int := 10000; v_last text := ''; v_n int;
-- begin
--   loop
--     with src as (
--       select s.id, s.dropped_keys from public.leads_jsonb_slim_snapshot s
--       where s.id > v_last order by s.id limit v_chunk
--     ), upd as (
--       update public.leads l
--          set attribution = coalesce(l.attribution, '{}'::jsonb) || src.dropped_keys
--        from src where l.id = src.id returning 1
--     )
--     select count(*), max(id) into v_n, v_last from src;
--     exit when v_n = 0;
--     commit;
--   end loop;
-- end $$;


-- ---------------------------------------------------------------------
-- R3. Restore the RPC to its JSONB-predicate form (undoes the reader
--     cutover). Re-apply 2026-07-24-leads-paged-rpc.sql verbatim — it is
--     a DROP + CREATE and is self-contained, including the GRANTs.
--
--     Do this BEFORE R6 if you intend to drop the columns, because the
--     current RPC body references `is_legacy` / `legacy_source_tab` /
--     `campaign_clean`.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- R4. Drop the bridge trigger.
--     Safe on its own: it only stops the promoted columns from being
--     refreshed on future attribution writes. Existing values remain.
-- ---------------------------------------------------------------------
-- drop trigger if exists trg_leads_sync_legacy_columns on public.leads;
-- drop function if exists public.leads_sync_legacy_columns();


-- ---------------------------------------------------------------------
-- R5. Restore the pre-cutover indexes and drop the `_v2` set.
--     Build the old ones BEFORE dropping the new ones so no filter is
--     ever unindexed, and ANALYZE AFTER creating — not before.
-- ---------------------------------------------------------------------
-- create index concurrently if not exists idx_leads_legacy_active_created
--   on public.leads (created_at desc, id desc)
--   where merged_into is null and ((attribution ->> 'legacy') = 'true');
-- create index concurrently if not exists idx_leads_legacy_status_created
--   on public.leads (status, created_at desc, id desc)
--   where merged_into is null and ((attribution ->> 'legacy') = 'true');
-- create index concurrently if not exists idx_leads_legacy_tab_created
--   on public.leads ((attribution ->> 'legacy_source_tab'), created_at desc, id desc)
--   where merged_into is null and ((attribution ->> 'legacy') = 'true');
-- create index concurrently if not exists idx_leads_legacy_phone_trgm
--   on public.leads using gin (phone extensions.gin_trgm_ops)
--   where merged_into is null and ((attribution ->> 'legacy') = 'true');
-- create index concurrently if not exists idx_leads_legacy_name_trgm
--   on public.leads using gin (name extensions.gin_trgm_ops)
--   where merged_into is null and ((attribution ->> 'legacy') = 'true');
-- create index concurrently if not exists idx_leads_legacy_source_tab_partial
--   on public.leads ((attribution ->> 'legacy_source_tab'))
--   where ((attribution ->> 'legacy') = 'true');
--
-- analyze public.leads;
--
-- drop index concurrently if exists public.idx_leads_legacy_active_created_v2;
-- drop index concurrently if exists public.idx_leads_legacy_status_created_v2;
-- drop index concurrently if exists public.idx_leads_legacy_tab_created_v2;
-- drop index concurrently if exists public.idx_leads_legacy_phone_trgm_v2;
-- drop index concurrently if exists public.idx_leads_legacy_name_trgm_v2;
-- drop index concurrently if exists public.idx_leads_nonlegacy_active_created_v2;


-- ---------------------------------------------------------------------
-- R6. Drop the promoted columns (undoes items 2 + 3).
--     Requires R3 and R4 first. Irreversible only in the sense that the
--     columns are rederivable at any time from the retained JSONB keys.
-- ---------------------------------------------------------------------
-- alter table public.leads
--   drop column if exists is_legacy,
--   drop column if exists legacy_source_tab,
--   drop column if exists campaign_clean;
-- alter table public.leads drop constraint if exists leads_is_legacy_not_null;


-- ---------------------------------------------------------------------
-- R7. Drop the new tables. LAST — R1 and R2 read from them.
-- ---------------------------------------------------------------------
-- drop table if exists public.lead_legacy_touches;
-- drop table if exists public.leads_jsonb_slim_snapshot;


-- ---------------------------------------------------------------------
-- R8. Scratch tables used by the chunked jobs. Safe to drop at any time;
--     they hold only progress cursors and captured EXPLAIN output.
-- ---------------------------------------------------------------------
-- drop table if exists public._slim_cursor;
-- drop table if exists public._slim_verify;
-- drop table if exists public._slim_plans;


-- ---------------------------------------------------------------------
-- NOT TOUCHED BY THIS ROLLBACK (deliberately):
--   * `legacy_status_backfill_snapshot` — owns the Phase 0c remap
--     rollback and is independent. Its `batch` / `pre_status` /
--     `pre_attribution` columns are self-sufficient; the
--     `legacy_status_backfill_batch` marker this migration removed from
--     `attribution` was never part of that rollback's join path.
--   * `leads_backfill_snapshot` — owns the Phase 2/3 import rollback.
--   * `idx_leads_active_nonlegacy_created` — never modified.
-- ---------------------------------------------------------------------
