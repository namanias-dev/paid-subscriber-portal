-- ============================================================================
-- SMS variable store (ADDITIVE — breaks nothing).
--
-- Backs the Mission Control "Variables" tab: editable template variables that
-- apply to new sends immediately WITHOUT a code change/redeploy — e.g. the
-- login link (LOGIN_URL) which the provider rotates ~every 15 days.
--
-- One row per SCOPE:
--   scope = 'global'      → variables shared across all templates (e.g. login_url)
--   scope = '<templateId>'→ per-template overrides (win over global)
--
-- Same access model as sms_settings: single jsonb blob per row, service-role
-- only (all reads/writes go through guarded admin API routes). If this table is
-- absent the app falls back to the config/env defaults (no regression).
-- ============================================================================
create table if not exists public.sms_variables (
  scope      text primary key,                 -- 'global' or an sms_templates.id
  data       jsonb not null default '{}',      -- { variableKey: value }
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.sms_variables enable row level security;
-- No policies => only the service role (used by guarded admin APIs) can read/write.
