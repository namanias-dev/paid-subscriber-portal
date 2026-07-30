-- Additive: behaviour-driven lead status + manual verdict preservation.
-- NO drops, NO renames. Extends leads_status_vocab with Webinar Registered + Seat Booked.
-- Indexes: CREATE INDEX CONCURRENTLY (run outside transaction — applied live via SQL editor).

-- ---------------------------------------------------------------------------
-- 1. Manual verdict + status origin (Rule Zero)
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists status_origin text,
  add column if not exists status_system_verified_at timestamptz,
  add column if not exists manual_status text,
  add column if not exists manual_status_at timestamptz,
  add column if not exists manual_status_by text,
  add column if not exists manual_status_by_role text,
  add column if not exists manual_status_note text;

comment on column public.leads.status_origin is
  'Who last set leads.status: staff | system | import | unknown. Behaviour flips set system; staff PATCH sets staff.';
comment on column public.leads.manual_status is
  'Preserved staff (or pre-system) verdict. NEVER overwritten by behaviour flips once set; staff PATCH may update.';
comment on column public.leads.status_system_verified_at is
  'When status was last written by the behaviour engine.';

-- Soft CHECK on origin (nullable for backfill window)
alter table public.leads drop constraint if exists leads_status_origin_vocab;
alter table public.leads
  add constraint leads_status_origin_vocab check (
    status_origin is null
    or status_origin = any (array[
      'staff'::text,
      'system'::text,
      'import'::text,
      'unknown'::text
    ])
  ) not valid;

alter table public.leads validate constraint leads_status_origin_vocab;

-- ---------------------------------------------------------------------------
-- 2. Extend status vocabulary (additive — existing 13 values unchanged)
-- ---------------------------------------------------------------------------
alter table public.leads drop constraint if exists leads_status_vocab;

alter table public.leads
  add constraint leads_status_vocab check (
    status is null or status = any (array[
      'Not Called'::text,
      'Not Replied'::text,
      'Call Back'::text,
      'Interested'::text,
      'High Potential Lead'::text,
      'Wants Free Seminar'::text,
      'Walk In'::text,
      'Demo Booked'::text,
      'Demo Attended'::text,
      'Webinar Registered'::text,
      'Seat Booked'::text,
      'Admission Done'::text,
      'Repeat'::text,
      'Not Interested'::text,
      'Wrong No.'::text
    ])
  ) not valid;

alter table public.leads validate constraint leads_status_vocab;

-- ---------------------------------------------------------------------------
-- 3. Indexes (also apply with CONCURRENTLY outside a txn — see apply notes)
-- ---------------------------------------------------------------------------
-- Partial index for disparity report: rows with both manual + system status.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_manual_system_disparity
--   ON public.leads (manual_status, status)
--   WHERE merged_into IS NULL AND manual_status IS NOT NULL AND status_origin = 'system';

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_status_origin
--   ON public.leads (status_origin)
--   WHERE merged_into IS NULL AND status_origin IS NOT NULL;
