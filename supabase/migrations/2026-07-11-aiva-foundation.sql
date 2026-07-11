-- =====================================================================================
-- AIVA Foundation (Phase 1) — canonical business event layer + AIVA control tables.
--
-- ADDITIVE ONLY. This migration does NOT alter, drop, or rename any existing table or column.
-- It is safe to apply to production: it only CREATEs new tables/indexes IF NOT EXISTS.
-- RLS is enabled with NO anon policies (service-role only), matching the portal convention.
--
-- Rollback: see docs/aiva/ROLLBACK.md (DROP TABLE ... the aiva_* / business_events tables).
-- =====================================================================================

-- ---------- Canonical business event stream ----------
create table if not exists public.business_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_type text,
  actor_id text,
  anonymous_session_id text,
  student_id text,
  lead_id text,
  enrollment_id text,
  payment_id text,
  course_id text,
  webinar_id text,
  campaign_id text,
  source text,
  payload_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  idempotency_key text,
  schema_version int not null default 1,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_business_events_idem on public.business_events (idempotency_key) where idempotency_key is not null;
create index if not exists ix_business_events_type_time on public.business_events (event_type, occurred_at desc);
create index if not exists ix_business_events_payment on public.business_events (payment_id) where payment_id is not null;
create index if not exists ix_business_events_enrollment on public.business_events (enrollment_id) where enrollment_id is not null;
create index if not exists ix_business_events_lead on public.business_events (lead_id) where lead_id is not null;

-- ---------- Codebase intelligence snapshots ----------
create table if not exists public.aiva_codebase_snapshots (
  id uuid primary key default gen_random_uuid(),
  commit_sha text not null,
  indexed_at timestamptz not null default now(),
  affected_domains text[] not null default '{}',
  manifest_hash text,
  status text not null default 'ok',
  validation_results jsonb not null default '{}'::jsonb
);
create index if not exists ix_aiva_snapshots_time on public.aiva_codebase_snapshots (indexed_at desc);
create unique index if not exists uq_aiva_snapshots_sha on public.aiva_codebase_snapshots (commit_sha);

-- ---------- Recommendations (drafts) ----------
create table if not exists public.aiva_recommendations (
  id uuid primary key default gen_random_uuid(),
  agent text not null,
  title text not null,
  rationale text,
  risk text not null default 'green',
  tool text,
  status text not null default 'draft',   -- draft | approved | rejected | expired
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_aiva_recs_status on public.aiva_recommendations (status, created_at desc);

-- ---------- Action approval workflow ----------
create table if not exists public.aiva_action_requests (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid,
  tool text not null,
  risk text not null,
  requested_by text,
  summary jsonb not null default '{}'::jsonb,   -- what/why/affected/impact/risks/exclusions/preview/rollback
  idempotency_key text,
  status text not null default 'pending',        -- pending | approved | rejected | expired | executed
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_aiva_action_idem on public.aiva_action_requests (idempotency_key) where idempotency_key is not null;
create index if not exists ix_aiva_action_status on public.aiva_action_requests (status, created_at desc);

create table if not exists public.aiva_action_approvals (
  id uuid primary key default gen_random_uuid(),
  action_request_id uuid not null,
  approver_id text,
  decision text not null,                        -- approved | rejected
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.aiva_action_runs (
  id uuid primary key default gen_random_uuid(),
  action_request_id uuid not null,
  status text not null default 'queued',         -- queued | running | succeeded | failed | dead_letter
  attempts int not null default 0,
  result jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Immutable AIVA audit log ----------
create table if not exists public.aiva_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id text,
  actor_username text,
  action text not null,
  target_type text,
  target_id text,
  risk text,
  outcome text not null,                          -- allowed | blocked | read
  reason text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ix_aiva_audit_time on public.aiva_audit_log (created_at desc);
create index if not exists ix_aiva_audit_actor on public.aiva_audit_log (actor_id, created_at desc);

-- ---------- System health check log ----------
create table if not exists public.aiva_system_health_checks (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  status text not null,
  detail text,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists ix_aiva_health_time on public.aiva_system_health_checks (created_at desc);

-- ---------- RLS: enable, no anon policies (service-role only, matching portal convention) ----------
alter table public.business_events enable row level security;
alter table public.aiva_codebase_snapshots enable row level security;
alter table public.aiva_recommendations enable row level security;
alter table public.aiva_action_requests enable row level security;
alter table public.aiva_action_approvals enable row level security;
alter table public.aiva_action_runs enable row level security;
alter table public.aiva_audit_log enable row level security;
alter table public.aiva_system_health_checks enable row level security;
