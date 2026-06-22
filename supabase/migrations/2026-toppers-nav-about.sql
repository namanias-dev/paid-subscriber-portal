-- =====================================================================
-- Toppers, navbar visibility & About-page content for site_settings.
-- Adds three jsonb columns. Idempotent & backward-compatible — existing
-- rows keep working and the app seeds defaults for empty values.
-- Safe to run multiple times.
-- =====================================================================

alter table public.site_settings add column if not exists toppers jsonb not null default '[]'::jsonb;
alter table public.site_settings add column if not exists nav jsonb not null default '{}'::jsonb;
alter table public.site_settings add column if not exists about jsonb not null default '{}'::jsonb;

-- Refresh PostgREST schema cache so the new columns are recognised immediately.
notify pgrst, 'reload schema';
