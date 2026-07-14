-- ============================================================================
-- Journey Automation — STAFF TASKS (Phase 5 hardening). ADDITIVE ONLY.
--
-- The Staff Task node records a task for a human. There is no generic staff-task
-- system to reuse (ai_followups is coupled to the AI-counsellor lead pipeline and
-- is a latent auto-outreach queue — reusing it risks a hidden dispatch path), so
-- we add a minimal journey-owned task record. IMPORTANT: this table has NO
-- dispatcher/worker and NO send path — it is a view-only record surfaced in the
-- runs monitor. Creating a row is the ONLY write; it mutates NO business record.
--
-- ROLLBACK: drop table + indexes at the bottom. No business object is touched.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.automation_staff_tasks (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid references public.automation_enrollments(id) on delete cascade,
  workflow_id    uuid references public.automation_workflows(id) on delete set null,
  node_key       text,
  title          text not null,
  assignee       text,
  detail         jsonb not null default '{}'::jsonb,
  status         text not null default 'open' check (status in ('open','done','dismissed')),
  mode           text not null default 'simulate' check (mode in ('simulate','live')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists automation_staff_tasks_wf_idx on public.automation_staff_tasks (workflow_id, created_at desc);
create index if not exists automation_staff_tasks_enrollment_idx on public.automation_staff_tasks (enrollment_id);
create index if not exists automation_staff_tasks_status_idx on public.automation_staff_tasks (status);

alter table public.automation_staff_tasks enable row level security;

-- ============================================================================
-- ROLLBACK:
--   drop table if exists public.automation_staff_tasks cascade;
-- ============================================================================
