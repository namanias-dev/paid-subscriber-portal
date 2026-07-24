-- =====================================================================
-- Phase 1 — legacy worklist SCHEMA + PERF foundation (additive only).
--
-- Context: the 2026-07-24 status remap promoted 115,542 of the 178,183
-- legacy leads off the platform default `New` onto real CRM statuses.
-- Those rows are now segmentable, but they carry none of the fields a
-- human actually needs to WORK them (owner, queue, follow-up) and none
-- of the fields required to contact them SAFELY (consent, DND,
-- suppression). This migration adds both, plus the cohort provenance
-- that keeps historical channel reporting honest.
--
-- SAFETY POSTURE
-- --------------
-- * Every column added here is NULLABLE. No NOT NULL, no rewrite of any
--   pre-existing column, no destructive change.
-- * `ADD COLUMN ... IF NOT EXISTS` throughout — idempotent, safe to
--   re-apply.
-- * Indexes are NOT in this file. `CREATE INDEX CONCURRENTLY` cannot run
--   inside a transaction block, and migration runners wrap files in one.
--   They live in `2026-07-24-legacy-worklist-indexes.sql` and are applied
--   as standalone statements.
-- * Rollback: `2026-07-24-legacy-worklist-foundation-rollback.sql`.
--   Because every column is new, `DROP COLUMN` is a COMPLETE reversal —
--   there is no pre-existing state to restore (the pre-state of every one
--   of these columns, on every one of the 179,170 active rows, is
--   literally NULL). See the audit-table note below.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. WORKABILITY — who owns this lead and when do we touch it next.
-- ---------------------------------------------------------------------
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_to     text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS worklist_queue  text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_at    timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_worked_at  timestamptz;

-- NOTE: `follow_up_date date` already exists and is used by the live CRM.
-- `follow_up_at` is deliberately a SEPARATE timestamptz column rather than
-- a widening of the existing one: widening would rewrite a column the live
-- Kanban reads, which is not additive. The worklist uses `follow_up_at`;
-- the live CRM keeps using `follow_up_date`. No backfill between them.

-- ---------------------------------------------------------------------
-- 2. CONSENT / CONTACT SAFETY — the gate that must exist BEFORE any
--    re-engagement surface is built on top of these 178k phones.
--
--    `consent_status` defaults to 'unknown' and is backfilled to
--    'unknown' for every existing row. We deliberately DO NOT infer
--    consent from the legacy sheet: a phone appearing in a 2023 Google
--    Sheet is not evidence that the person agreed to be contacted in
--    2026. Anything other than an explicit, recorded capture stays
--    'unknown'.
-- ---------------------------------------------------------------------
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS consent_status       text DEFAULT 'unknown';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS consent_source       text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS consent_captured_at  timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS dnd_status           text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS dnd_checked_at       timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_contacted_at    timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS contact_attempt_count integer DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS suppression_reason   text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS opted_out_at         timestamptz;

-- ---------------------------------------------------------------------
-- 3. COHORT / ATTRIBUTION PROVENANCE
--
--    CANONICAL LEGACY-VS-LIVE DEFINITION (single source of truth):
--
--        legacy  ==  (attribution ->> 'legacy') = 'true'
--
--    This is EXACTLY the predicate already used by `hasLegacyFlag()` in
--    `lib/legacy-migration/legacyFilter.ts`, by `applyLegacyFilter`, and
--    by the shipped partial index `idx_leads_active_nonlegacy_created`.
--    Phase 1 adopts it verbatim rather than inventing a second notion.
--
--    THE 110-ROW QUESTION (resolved here, deliberately):
--    110 active rows carry `import_source = 'legacy_sheet'` but do NOT
--    carry `attribution.legacy = true`. They are pre-existing LIVE leads
--    that the importer matched and enriched, rather than rows the import
--    created. They are classified `live_captured`.
--
--    Reason: they have always been counted as live in historical channel
--    reporting. Reclassifying them to `legacy_promoted` would move them
--    out of the live aggregate and retroactively rewrite already-published
--    channel numbers — precisely what the cohort field exists to prevent.
--    `cohort` records how a lead entered the CRM as a countable lead, NOT
--    whether any legacy data ever touched it. The legacy touch remains
--    fully discoverable via `import_source = 'legacy_sheet'`.
--
--    `cohort` is a plain frozen column, NOT a GENERATED column. A
--    generated column would recompute from `attribution` on every write,
--    so a later edit to that JSONB would silently reclassify the lead and
--    move it between historical buckets. Freezing the classification at
--    backfill time is the whole point.
-- ---------------------------------------------------------------------
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS cohort       text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS promoted_at  timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS promoted_by  text;

-- ---------------------------------------------------------------------
-- 4. LEAD NOTES — child table, NOT a text blob on `leads`.
--
--    A blob column cannot answer "who wrote this and when", forces a
--    read-modify-write on every append (lost updates under concurrency),
--    and bloats every row of a 179k-row table that is already 299 MB.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_notes (
  id          text PRIMARY KEY,
  lead_id     text NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  author      text,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 5. BACKFILL AUDIT
--
--    Why this table holds COUNTS and not 179,170 before-images: every
--    column above is brand new, so the pre-state of each is uniformly
--    NULL on every row. A row-level snapshot would be 179,170 copies of
--    NULL — pure storage with zero recovery value. What is actually worth
--    recording is the classification predicate and the resulting bucket
--    sizes, so the backfill can be independently re-derived and audited.
--    Full reversal remains `DROP COLUMN` (see the rollback file).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_cohort_backfill_audit (
  batch          text PRIMARY KEY,
  predicate      text NOT NULL,
  live_captured  integer NOT NULL,
  legacy_promoted integer NOT NULL,
  consent_unknown integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
