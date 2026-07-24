-- =====================================================================
-- Phase 1c — indexes backing `getLeadsPaged`.
--
-- These are SEPARATE from the schema migration because
-- `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block and
-- migration runners wrap a file in one. Apply these as standalone
-- statements (they were applied in prod 2026-07-24 via Supabase MCP
-- `execute_sql`, one statement per call).
--
-- =====================================================================
-- PREDICATE MATCHING — READ THIS BEFORE EDITING ANY PREDICATE BELOW
-- =====================================================================
-- A partial index is only used when the planner can PROVE the query
-- predicate implies the index predicate. It does not reason
-- semantically; it pattern-matches expression trees. So a partial index
-- predicate MUST be written in the same shape PostgREST emits.
--
-- This bit us on 2026-07-24. `idx_leads_active_nonlegacy_created` was
-- first written with the elegant form:
--
--     WHERE (attribution ->> 'legacy') IS DISTINCT FROM 'true'
--
-- ...but the app fires a PostgREST `.or(...)` which emits a three-arm
-- OR. The planner cannot prove those equivalent, silently fell back to
-- the wider `idx_leads_active_created`, and the query took 65,171 ms.
-- Rewritten in the OR form it took 285 ms. Same rows, same data, 228x.
--
-- Therefore:
--   * NON-LEGACY side  -> three-arm OR form. NEVER `IS DISTINCT FROM`.
--       PostgREST: .or("attribution.is.null,
--                       attribution->>legacy.is.null,
--                       attribution->>legacy.neq.true")
--   * LEGACY side      -> plain equality.
--       PostgREST: .filter("attribution->>legacy", "eq", "true")
--       emits:     (attribution ->> 'legacy') = 'true'
--
-- Every legacy-side predicate below is the plain-equality form, which is
-- exactly what `getLeadsPaged` emits. Verified by EXPLAIN (ANALYZE) —
-- see the Phase 1 ship record.
--
-- SORT KEY: `(created_at DESC, id DESC)`. `id` is NOT decoration — 856
-- distinct `created_at` values are shared by 2+ active rows and one
-- timestamp is shared by 168 rows (the Google Ads tab, which imported
-- with no original timestamp). A `created_at`-only cursor would silently
-- skip rows across a page boundary inside a tie group. The compound key
-- makes the keyset total and the pagination lossless.
-- =====================================================================

-- 1. Legacy worklist, unfiltered: page 1 and deep pages.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_legacy_active_created
  ON public.leads (created_at DESC, id DESC)
  WHERE merged_into IS NULL AND ((attribution ->> 'legacy') = 'true');

-- 2. Queue-scoped worklist (the primary Phase 2 read shape).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_worklist_queue_created
  ON public.leads (worklist_queue, created_at DESC, id DESC)
  WHERE merged_into IS NULL AND worklist_queue IS NOT NULL;

-- 3. "My leads" — per-owner worklist.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_assigned_created
  ON public.leads (assigned_to, created_at DESC, id DESC)
  WHERE merged_into IS NULL AND assigned_to IS NOT NULL;

-- 4. Status-filtered legacy segment. The remap made `status` a
--    high-cardinality, high-value filter on the legacy side (62,770
--    Not Replied / 37,447 Not Interested / 12,783 Interested), so this
--    carries the sort key too and avoids a 100k-row sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_legacy_status_created
  ON public.leads (status, created_at DESC, id DESC)
  WHERE merged_into IS NULL AND ((attribution ->> 'legacy') = 'true');

-- 5. Source-tag-filtered legacy segment (FB LEADS / Copy of FB LEADS /
--    WhatsApp / ...).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_legacy_tab_created
  ON public.leads ((attribution ->> 'legacy_source_tab'), created_at DESC, id DESC)
  WHERE merged_into IS NULL AND ((attribution ->> 'legacy') = 'true');

-- 6. Consent-gated reads. Spans BOTH cohorts on purpose: the safety
--    question "who may we contact" is not legacy-specific.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_consent_created
  ON public.leads (consent_status, created_at DESC, id DESC)
  WHERE merged_into IS NULL;

-- 7. Notes lookup for a lead, newest first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_notes_lead_created
  ON public.lead_notes (lead_id, created_at DESC);

-- ROLLBACK (code revert FIRST, then these):
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_legacy_active_created;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_worklist_queue_created;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_assigned_created;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_legacy_status_created;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_legacy_tab_created;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_consent_created;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_lead_notes_lead_created;
