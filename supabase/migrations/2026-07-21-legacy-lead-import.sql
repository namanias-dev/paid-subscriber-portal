-- Legacy lead migration — ADDITIVE, NULLABLE, REVERSIBLE.
-- Ships alongside Phase 2 code that is gated by LEGACY_IMPORT_ENABLED (default OFF).
-- With flags off, no code path writes to any of these columns and existing behaviour is unchanged.
-- Rollback lives in the paired -rollback.sql file (marked MANUAL — do not auto-apply).
--
-- Adds five nullable columns to public.leads, three partial indexes, one snapshot table,
-- and one sheets-sync watermark table. All statements are idempotent (IF NOT EXISTS)
-- so a re-apply is safe.
alter table public.leads
  add column if not exists channel_legacy text,
  add column if not exists import_source text,
  add column if not exists import_batch text,
  add column if not exists external_lead_id text,
  add column if not exists first_seen_at timestamptz;

comment on column public.leads.channel_legacy is
  'Inferred acquisition channel for legacy-imported rows (never set for live-capture rows). '
  'Populated by scripts/legacy-lead-import.ts; downstream surfaces treat COALESCE(channel, channel_legacy) '
  'as the effective channel only when they explicitly opt in to legacy visibility.';
comment on column public.leads.import_source is
  'Origin bucket for the row: "legacy_sheet" (one-time backfill), "sheets_sync" (Phase 2B cron), '
  '"meta_leadgen" (Phase 2C webhook), or NULL for live-capture rows.';
comment on column public.leads.import_batch is
  'ISO-8601 timestamp of the batch run that inserted this row. Also used as the fallback '
  'created_at for tabs missing a source timestamp (e.g. the legacy Google Ads tab).';
comment on column public.leads.external_lead_id is
  'Source-specific stable ID for idempotency. Legacy: "<tab>:<source_row_number>". '
  'Sheets sync: "<spreadsheet_id>:<tab>:<row>". Meta Lead Ads: the leadgen_id.';
comment on column public.leads.first_seen_at is
  'Original acquisition timestamp from the source system. Independent of created_at, which is '
  'when the row was inserted into the portal. NULL when the source tab has no timestamp column.';

-- Partial index that only stores rows carrying the legacy marker — near-zero cost when there are none,
-- meaningful acceleration once the backfill runs. Used by the includeLegacy=false filter in getLeads().
create index if not exists idx_leads_legacy_flag
  on public.leads ((attribution ->> 'legacy'))
  where attribution ->> 'legacy' = 'true';

create index if not exists idx_leads_import_batch
  on public.leads (import_batch)
  where import_batch is not null;

create index if not exists idx_leads_channel_legacy
  on public.leads (channel_legacy)
  where channel_legacy is not null;

-- One row per lead the backfill touches. Enables a one-line rollback of an import batch.
-- pre_state is NULL for pure inserts (the whole row is the "backfill") and carries the pre-patch
-- JSONB for collision NULL-fills so a revert can restore the exact prior attribution state.
create table if not exists public.leads_backfill_snapshot (
  id text primary key,
  import_batch text not null,
  was_collision boolean not null default false,
  snapshot_at timestamptz not null default now(),
  pre_state jsonb
);
create index if not exists idx_leads_backfill_snapshot_batch
  on public.leads_backfill_snapshot (import_batch);

comment on table public.leads_backfill_snapshot is
  'One row per lead touched by scripts/legacy-lead-import.ts --commit. Powers the two-step '
  'rollback: DELETE the pure inserts; UPDATE the collision NULL-fills back to their pre_state.';

-- Phase 2B (Sheets Sync) watermark table. Ships now so the sync route can rely on the table
-- existing; the route itself is a 501 stub until SHEETS_SYNC_ENABLED is flipped.
create table if not exists public.legacy_import_sync_state (
  spreadsheet_id text not null,
  tab_name text not null,
  last_row_index integer not null default 0,
  last_synced_at timestamptz not null default now(),
  last_error text,
  primary key (spreadsheet_id, tab_name)
);

comment on table public.legacy_import_sync_state is
  'Per-(spreadsheet, tab) watermark for the Phase 2B ongoing Sheets sync. Rows are inserted '
  'on first sync and updated after every successful pass; last_row_index prevents re-fetching '
  'the whole tab. Untouched while SHEETS_SYNC_ENABLED is false.';
