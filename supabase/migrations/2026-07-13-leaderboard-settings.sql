-- ============================================================================
-- Leaderboard settings — GLOBAL, admin-managed config for the Performance
-- Leaderboard (single source of truth shared by admin + any student view).
--
-- Stored as one jsonb column on the existing single-row `site_settings` table,
-- consistent with how other admin settings (brand, toppers, nav, about) live:
--   { "excludedStudentIds": ["<students.id>", ...], "reliabilityC": 3 }
--
-- Fully additive & idempotent — safe to run repeatedly. No data is mutated;
-- existing rows simply gain the column defaulted to '{}' (empty config, which
-- the app reads as: no admin exclusions, default C).
-- ============================================================================

alter table public.site_settings
  add column if not exists leaderboard jsonb not null default '{}'::jsonb;

-- Ensure the singleton settings row exists (no-op if already present).
insert into public.site_settings (id) values ('home') on conflict (id) do nothing;
