-- ============================================================================
-- Journey Automation — DURABLE EXECUTION RUNTIME (Phase 3/4). ADDITIVE ONLY.
--
-- Adds the runtime tables for the execution engine + SMS adapter. Nothing here
-- sends: the engine's default mode is SIMULATION (records intended actions, sends
-- NOTHING). Real sends only happen when a workflow's execution_mode='live' AND the
-- env flags (EXECUTION/SMS + category) are on AND the kill switch is clear — and
-- even then only through the EXISTING chokepoint (lib/sms/service.ts sendSms).
--
-- Only NEW tables + additive columns on already-journey-owned tables
-- (automation_events, automation_workflows). NO business table (payments,
-- enrollments, access, students, sms_*) is touched.
--
-- Concurrency/durability follow the sms_logs pattern: insert-first UNIQUE dedupe
-- for idempotency, plus a SKIP LOCKED claim function so overlapping cron/worker
-- invocations never double-process a job.
--
-- ROLLBACK: see the DROP block at the bottom. Clean + complete.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Additive columns on journey-owned tables (safe; not business truth).
-- ---------------------------------------------------------------------------

-- Matcher cursor: an event is enrolled at most once (idempotent re-drain).
alter table public.automation_events   add column if not exists processed_at timestamptz;
create index if not exists automation_events_unprocessed_idx
  on public.automation_events (occurred_at) where processed_at is null;

-- Per-workflow rollout control (CANARY). Default 'off' => the engine does NOTHING
-- for this workflow. A human moves it to 'simulate' (dry soak) then 'live'. Even
-- 'live' still needs the env flags on to actually send.
alter table public.automation_workflows add column if not exists execution_mode text not null default 'off'
  check (execution_mode in ('off','simulate','live'));
-- Canary caps: max enrollments to process, and staff-test-only phone allowlist.
alter table public.automation_workflows add column if not exists canary_max_enrollments int;
alter table public.automation_workflows add column if not exists canary_test_phones text[];

-- ---------------------------------------------------------------------------
-- Enrollments — a contact's RUN of a workflow version (enrollment == run record).
-- ---------------------------------------------------------------------------
create table if not exists public.automation_enrollments (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references public.automation_workflows(id) on delete cascade,
  version_id        uuid not null references public.automation_workflow_versions(id) on delete cascade,
  event_id          uuid references public.automation_events(id) on delete set null,
  normalized_phone  text,
  student_id        text,
  lead_id           text,
  enrollment_ref    text,                                  -- course_enrollments.id (read-only reference)
  mode              text not null default 'simulate' check (mode in ('simulate','live')),
  status            text not null default 'active'
                      check (status in ('active','completed','exited','cancelled','goal_met','failed')),
  current_node_key  text,
  context           jsonb not null default '{}'::jsonb,    -- non-secret trigger snapshot
  goal_met          boolean not null default false,
  exit_reason       text,
  dedupe_key        text,                                  -- UNIQUE: one enrollment per (version,phone,event)
  enrolled_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz
);
create unique index if not exists automation_enrollments_dedupe_uq
  on public.automation_enrollments (dedupe_key) where dedupe_key is not null;
-- At most ONE active enrollment per contact per workflow.
create unique index if not exists automation_enrollments_active_uq
  on public.automation_enrollments (workflow_id, normalized_phone) where status = 'active';
create index if not exists automation_enrollments_status_idx on public.automation_enrollments (status);
create index if not exists automation_enrollments_wf_idx on public.automation_enrollments (workflow_id, enrolled_at desc);

-- ---------------------------------------------------------------------------
-- Node runs — per-node execution record (status, resolved variables MINUS
-- secrets, outcome). One row per (enrollment, node) => idempotent execution.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_node_runs (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references public.automation_enrollments(id) on delete cascade,
  workflow_id    uuid not null references public.automation_workflows(id) on delete cascade,
  node_key       text not null,
  node_type      text not null,
  status         text not null default 'pending'
                   check (status in ('pending','done','simulated','sent','suppressed','skipped','failed')),
  mode           text not null default 'simulate' check (mode in ('simulate','live')),
  resolved_variables jsonb not null default '{}'::jsonb,   -- NEVER contains secrets/login codes
  outcome        jsonb not null default '{}'::jsonb,
  idempotency_key text,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (enrollment_id, node_key)
);
create index if not exists automation_node_runs_enrollment_idx on public.automation_node_runs (enrollment_id);
create index if not exists automation_node_runs_status_idx on public.automation_node_runs (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Jobs — the durable queue. scheduled_for + status + attempts + UNIQUE dedupe +
-- dead_letter. Survives restarts (rows persist); crash recovery = re-drain.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_jobs (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references public.automation_enrollments(id) on delete cascade,
  workflow_id    uuid not null references public.automation_workflows(id) on delete cascade,
  node_key       text not null,                            -- the node to execute
  kind           text not null default 'execute_node',
  status         text not null default 'queued'
                   check (status in ('queued','running','done','failed','cancelled','dead')),
  scheduled_for  timestamptz not null default now(),
  attempts       int not null default 0,
  max_attempts   int not null default 5,
  dedupe_key     text,                                     -- UNIQUE: one pending job per (enrollment,node)
  last_error     text,
  dead_letter    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
create unique index if not exists automation_jobs_dedupe_uq
  on public.automation_jobs (dedupe_key) where dedupe_key is not null;
create index if not exists automation_jobs_due_idx
  on public.automation_jobs (scheduled_for) where status = 'queued';
create index if not exists automation_jobs_enrollment_idx on public.automation_jobs (enrollment_id);
create index if not exists automation_jobs_dead_idx on public.automation_jobs (dead_letter) where dead_letter = true;

-- ---------------------------------------------------------------------------
-- Goal completions — conversion + attribution record.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_goal_completions (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references public.automation_enrollments(id) on delete cascade,
  workflow_id    uuid not null references public.automation_workflows(id) on delete cascade,
  goal_node_key  text,
  goal_type      text,
  attributed_event text,                                   -- what satisfied the goal (e.g. payment_received)
  mode           text not null default 'simulate',
  completed_at   timestamptz not null default now(),
  unique (enrollment_id, goal_node_key)
);
create index if not exists automation_goal_completions_wf_idx on public.automation_goal_completions (workflow_id, completed_at desc);

-- ---------------------------------------------------------------------------
-- Suppression events — audit of every time a send/action was suppressed by
-- eligibility, latest-state recheck, guard, quiet-hours, or cap.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_suppression_events (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid references public.automation_enrollments(id) on delete cascade,
  workflow_id    uuid references public.automation_workflows(id) on delete set null,
  node_key       text,
  normalized_phone text,
  reason         text not null,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists automation_suppression_events_wf_idx on public.automation_suppression_events (workflow_id, created_at desc);
create index if not exists automation_suppression_events_reason_idx on public.automation_suppression_events (reason);

-- ---------------------------------------------------------------------------
-- Atomic job claim (SKIP LOCKED) — overlapping workers never grab the same job.
-- ---------------------------------------------------------------------------
create or replace function public.automation_claim_jobs(p_limit int)
returns setof public.automation_jobs
language plpgsql as $$
begin
  return query
  update public.automation_jobs j
     set status = 'running', attempts = j.attempts + 1, started_at = now(), updated_at = now()
   where j.id in (
     select id from public.automation_jobs
      where status = 'queued' and scheduled_for <= now()
      order by scheduled_for asc
      for update skip locked
      limit p_limit
   )
  returning j.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: service-role only (guarded server code / cron). Enable, no policies.
-- ---------------------------------------------------------------------------
alter table public.automation_enrollments        enable row level security;
alter table public.automation_node_runs          enable row level security;
alter table public.automation_jobs               enable row level security;
alter table public.automation_goal_completions   enable row level security;
alter table public.automation_suppression_events enable row level security;

-- ============================================================================
-- ROLLBACK (run manually to fully undo this migration):
--   drop function if exists public.automation_claim_jobs(int);
--   drop table if exists public.automation_suppression_events cascade;
--   drop table if exists public.automation_goal_completions cascade;
--   drop table if exists public.automation_jobs cascade;
--   drop table if exists public.automation_node_runs cascade;
--   drop table if exists public.automation_enrollments cascade;
--   alter table public.automation_workflows drop column if exists canary_test_phones;
--   alter table public.automation_workflows drop column if exists canary_max_enrollments;
--   alter table public.automation_workflows drop column if exists execution_mode;
--   alter table public.automation_events drop column if exists processed_at;
-- No business object is modified, so rollback is clean and complete.
-- ============================================================================
