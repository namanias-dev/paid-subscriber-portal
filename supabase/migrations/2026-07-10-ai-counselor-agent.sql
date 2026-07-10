-- =====================================================================
-- AI Counselor Agent — Phase 1 (SHIP DARK, additive-only).
--
-- Creates the agent's INTERNAL state tables. Nothing here touches existing
-- tables (payments, students, webinars, webinar_registrations, analytics_events,
-- roles, ...). These tables back the guided-flow lead counselor that is NOT yet
-- exposed to end users (AI_AGENT_PUBLIC_WIDGET=false).
--
-- Every statement is IDEMPOTENT (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT
-- EXISTS / CREATE INDEX IF NOT EXISTS) so it is safe to re-run and safe even if
-- the migration-tracking table is unreliable. IDs are text defaulting to
-- gen_random_uuid()::text to match this project's existing id convention.
--
-- NOTE (permissions): the admin capability key 'manage_ai_agent' is SCHEMALESS —
-- it lives in roles.permissions (JSONB map key->boolean) and needs NO DDL. Grant
-- it by editing a role's permissions JSONB. Super Admin inherits it automatically.
--
-- NOTE (registration dedupe): the FUTURE unique index on
-- webinar_registrations(webinar_id, phone) is intentionally NOT in this file (it
-- would fail while historical duplicates exist). See lib/ai-agent/registrationDedupe.ts.
-- =====================================================================

-- 1) ai_leads — one row per prospect (deduped by phone, fallback session_id).
create table if not exists public.ai_leads (
  id                    text primary key default gen_random_uuid()::text,
  session_id            text,
  phone                 text,
  email                 text,
  name                  text,
  city                  text,
  target_year           int,
  source                text,
  campaign              text,
  attribution_source    text,
  attribution_campaign  text,
  attribution_fbclid    text,
  attribution_fbc       text,
  score                 int not null default 0,
  temperature           text not null default 'cold',
  status                text not null default 'new',
  consent_analytics     boolean not null default false,
  consent_marketing     boolean not null default false,
  offer_interest        jsonb not null default '[]'::jsonb,
  notes                 text,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- Non-unique indexes (app-level dedupe; NO unique constraint on phone/session).
create index if not exists ai_leads_phone_idx      on public.ai_leads (phone);
create index if not exists ai_leads_session_id_idx on public.ai_leads (session_id);

-- 2) ai_conversations — one row per chat session.
create table if not exists public.ai_conversations (
  id              text primary key default gen_random_uuid()::text,
  session_id      text,
  lead_id         text,               -- FK-by-convention to ai_leads.id (no hard FK)
  provider        text not null default 'guided_flow',
  status          text not null default 'active',
  message_count   int not null default 0,
  summary         text,               -- REDACTED only
  meta            jsonb not null default '{}'::jsonb,
  started_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists ai_conversations_session_id_idx on public.ai_conversations (session_id);

-- 3) ai_lead_events — append-only agent events (distinct from analytics_events).
create table if not exists public.ai_lead_events (
  id          text primary key default gen_random_uuid()::text,
  session_id  text,
  lead_id     text,
  event_type  text,
  payload     jsonb not null default '{}'::jsonb,   -- REDACTED
  score_delta int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists ai_lead_events_session_id_idx on public.ai_lead_events (session_id);
create index if not exists ai_lead_events_lead_id_idx    on public.ai_lead_events (lead_id);

-- 4) ai_followups — scheduled follow-ups. SCHEMA ONLY in Phase 1 (NO sending).
create table if not exists public.ai_followups (
  id            text primary key default gen_random_uuid()::text,
  lead_id       text,
  session_id    text,
  type          text,
  channel       text,
  scheduled_for timestamptz,
  status        text not null default 'pending',
  payload       jsonb not null default '{}'::jsonb,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists ai_followups_status_idx        on public.ai_followups (status);
create index if not exists ai_followups_scheduled_for_idx on public.ai_followups (scheduled_for);

-- 5) ai_agent_settings — key/value config (singleton-style; upsert by key).
create table if not exists public.ai_agent_settings (
  id         text primary key default gen_random_uuid()::text,
  key        text,
  value      jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists ai_agent_settings_key_idx on public.ai_agent_settings (key);

-- 6) ai_offer_cache — cached snapshot of live offers (course|webinar).
create table if not exists public.ai_offer_cache (
  id         text primary key default gen_random_uuid()::text,
  offer_type text,                    -- 'course' | 'webinar'
  offer_id   text,
  snapshot   jsonb,
  is_bookable boolean,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists ai_offer_cache_offer_type_idx on public.ai_offer_cache (offer_type);

-- 7) ai_security_audit — audit log of sensitive admin/agent actions.
create table if not exists public.ai_security_audit (
  id          text primary key default gen_random_uuid()::text,
  actor       text,                   -- admin username/id or 'system'
  action      text,
  target_type text,
  target_id   text,
  ip          text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists ai_security_audit_created_at_idx on public.ai_security_audit (created_at);

-- Refresh PostgREST schema cache so the new tables are recognised immediately.
NOTIFY pgrst, 'reload schema';
