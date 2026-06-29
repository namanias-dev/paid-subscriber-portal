-- =====================================================================
-- Webinar lifecycle controls: auto-close registration, duplicate lineage,
-- and safe late-registration migration. Fully additive & idempotent —
-- existing webinars, registrants, payments and revenue records are untouched.
--
-- Design notes:
--  * Time is stored in UTC (timestamptz / ISO). "Has it ended?" is computed
--    on-read by comparing Date.now() to registration_closes_at|datetime — an
--    epoch-vs-epoch comparison that is inherently server-timezone independent.
--    No cron is required (Vercel Hobby friendly).
--  * Media/files are referenced by URL/id (cover_image_url, brochure_ids,
--    pdf_resources, materials, recording_link, video embeds), so duplicating a
--    webinar copies references only — it never deep-copies R2 binaries.
--  * "Moving" a registrant re-points its webinar_registrations.webinar_id and
--    the matching payments.item_slug to the target webinar (the portal resolves
--    a paid webinar by payment.item_slug), while audit columns preserve lineage.
--    No row is deleted, no revenue is duplicated, no student is re-created.
-- Safe to run multiple times.
-- =====================================================================

-- ---- webinars: registration lifecycle + lineage -------------------------
-- registration_status (admin intent): OPEN | CLOSED | DISABLED | DRAFT.
-- The EFFECTIVE status (incl. computed ENDED) is derived on-read in app code.
alter table public.webinars add column if not exists registration_status text not null default 'OPEN';
alter table public.webinars add column if not exists auto_close_registration boolean not null default true;
-- When null, registration closes at `datetime` (the start time).
alter table public.webinars add column if not exists registration_closes_at timestamptz;
-- Stamped when an admin/duplication marks a session ended (audit/display only).
alter table public.webinars add column if not exists ended_at timestamptz;
-- Lineage between an old session and its duplicate (for "next live session" CTA).
alter table public.webinars add column if not exists next_webinar_id text;
alter table public.webinars add column if not exists previous_webinar_id text;

-- ---- webinar_registrations: late-migration provenance -------------------
alter table public.webinar_registrations add column if not exists moved_from_webinar_id text;
alter table public.webinar_registrations add column if not exists moved_to_webinar_id text;
alter table public.webinar_registrations add column if not exists moved_at timestamptz;
alter table public.webinar_registrations add column if not exists moved_by text;
alter table public.webinar_registrations add column if not exists move_reason text;
alter table public.webinar_registrations add column if not exists is_moved_registration boolean not null default false;

-- ---- payments: late-migration provenance (paid webinar access) ----------
-- item_slug is re-pointed to the target webinar on move; these preserve the
-- original linkage + who/when/why for a full, reversible audit trail.
alter table public.payments add column if not exists moved_from_webinar_id text;
alter table public.payments add column if not exists moved_to_webinar_id text;
alter table public.payments add column if not exists moved_at timestamptz;
alter table public.payments add column if not exists moved_by text;
alter table public.payments add column if not exists move_reason text;
alter table public.payments add column if not exists is_moved_registration boolean not null default false;

-- ---- webinar_audit_log: lifecycle actions -------------------------------
create table if not exists public.webinar_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,             -- 'webinar_duplicated' | 'registration_moved' | 'registration_auto_closed' | 'payment_blocked_expired'
  webinar_id text,
  target_webinar_id text,
  actor text,                       -- admin username / 'system'
  count integer,                    -- affected rows (moves) when applicable
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists wal_created_idx on public.webinar_audit_log (created_at desc);
create index if not exists wal_webinar_idx on public.webinar_audit_log (webinar_id);
alter table public.webinar_audit_log enable row level security;

-- Refresh PostgREST schema cache so the new columns/tables are recognised.
notify pgrst, 'reload schema';
