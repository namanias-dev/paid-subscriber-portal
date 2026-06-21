-- =====================================================================
-- Site brand & contact: add brand jsonb column to site_settings.
-- Idempotent & backward-compatible. Safe to run multiple times.
-- =====================================================================

alter table public.site_settings add column if not exists brand jsonb not null default '{}'::jsonb;

-- Refresh PostgREST schema cache so the new column is recognised immediately.
notify pgrst, 'reload schema';
