-- ============================================================================
-- Admin portal enhancements (additive, idempotent)
--   F1 Content/LMS storage analytics — per-asset file sizes for notes + thumbs
--                                      (hosted video file_size + webinar
--                                       recording_file_size already exist).
--   F2 Lead CRM de-duplication        — source-history + soft-merge columns on
--                                       leads, plus first-touch attribution.
-- Nothing here alters or drops existing data; every add is nullable / IF NOT
-- EXISTS and safe to run multiple times.
-- ============================================================================

-- ---- F1: Content/LMS file sizes --------------------------------------------
-- Hosted lecture video size (content_items.file_size) and webinar recording
-- size (webinars.recording_file_size) already exist. Add sizes for the two
-- other R2-backed assets a content_item can carry so the Content/LMS storage
-- breakdown (Notes/PDFs, thumbnails) is accurate and backfillable.
alter table public.content_items
  add column if not exists notes_pdf_size  bigint,
  add column if not exists thumbnail_size  bigint;

-- ---- F2: Lead CRM de-duplication / stacking --------------------------------
-- A merged lead keeps a HISTORY of every touchpoint; the row's primary
-- source/campaign reflects the LAST touch, while first_source/first_campaign
-- preserve the first touch. `merged_into` soft-merges duplicates (never a hard
-- delete): a non-null value points at the surviving canonical lead id and hides
-- the row from all lists/segments.
alter table public.leads
  add column if not exists sources        jsonb not null default '[]'::jsonb,
  add column if not exists merged_into     text,
  add column if not exists merged_count    integer not null default 0,
  add column if not exists updated_at       timestamptz,
  add column if not exists first_source     text,
  add column if not exists first_campaign   text;

-- Seed updated_at for existing rows (idempotent: only fills nulls).
update public.leads set updated_at = created_at where updated_at is null;

-- Fast lookups for the ingestion de-dup guard (match active lead by phone) and
-- for filtering merged duplicates out of every list/segment read.
create index if not exists idx_leads_phone         on public.leads (phone);
create index if not exists idx_leads_merged_into    on public.leads (merged_into);
create index if not exists idx_leads_active_created on public.leads (created_at desc) where merged_into is null;
