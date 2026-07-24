-- =====================================================================
-- ROLLBACK for 2026-07-24-legacy-worklist-foundation.sql
--
-- ORDER MATTERS: revert the application code FIRST, then run this.
-- Dropping a column out from under a deployed build that still selects
-- it turns every lead read into a PostgREST 400.
--
-- This is a COMPLETE reversal. Every column dropped below was added by
-- the Phase 1 migration and had no prior existence, so there is no
-- pre-state to restore — the pre-state was NULL on all 179,170 active
-- rows. Nothing that existed before Phase 1 is touched here.
--
-- NOT touched by this rollback (deliberately):
--   * `legacy_status_backfill_snapshot` — owns the Phase 0c remap
--     rollback and is independent of Phase 1.
--   * `status` / `legacy_call_status` / `legacy_call_status_raw` — the
--     remap result. Rolling back Phase 1 must NOT revert Phase 0c.
--   * the saarthi import batch and its rollback.
-- =====================================================================

-- 1. Indexes first (cheapest to re-create, and they reference the columns).
DROP INDEX CONCURRENTLY IF EXISTS public.idx_lead_notes_lead_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_consent_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_legacy_tab_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_legacy_status_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_assigned_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_worklist_queue_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_legacy_active_created;

-- 2. Child + audit tables.
DROP TABLE IF EXISTS public.lead_notes;
DROP TABLE IF EXISTS public.lead_cohort_backfill_audit;

-- 3. Columns.
ALTER TABLE public.leads DROP COLUMN IF EXISTS promoted_by;
ALTER TABLE public.leads DROP COLUMN IF EXISTS promoted_at;
ALTER TABLE public.leads DROP COLUMN IF EXISTS cohort;
ALTER TABLE public.leads DROP COLUMN IF EXISTS opted_out_at;
ALTER TABLE public.leads DROP COLUMN IF EXISTS suppression_reason;
ALTER TABLE public.leads DROP COLUMN IF EXISTS contact_attempt_count;
ALTER TABLE public.leads DROP COLUMN IF EXISTS last_contacted_at;
ALTER TABLE public.leads DROP COLUMN IF EXISTS dnd_checked_at;
ALTER TABLE public.leads DROP COLUMN IF EXISTS dnd_status;
ALTER TABLE public.leads DROP COLUMN IF EXISTS consent_captured_at;
ALTER TABLE public.leads DROP COLUMN IF EXISTS consent_source;
ALTER TABLE public.leads DROP COLUMN IF EXISTS consent_status;
ALTER TABLE public.leads DROP COLUMN IF EXISTS last_worked_at;
ALTER TABLE public.leads DROP COLUMN IF EXISTS follow_up_at;
ALTER TABLE public.leads DROP COLUMN IF EXISTS worklist_queue;
ALTER TABLE public.leads DROP COLUMN IF EXISTS assigned_to;
