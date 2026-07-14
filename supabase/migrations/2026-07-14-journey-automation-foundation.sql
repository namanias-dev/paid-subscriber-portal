-- ============================================================================
-- Student Journey Automation — FOUNDATION (Phase 1). ADDITIVE ONLY.
--
-- Creates only NEW automation_* tables. No existing table is altered. This
-- shipment ships ZERO sending and ZERO execution: there are deliberately NO
-- runtime tables (no runs / jobs / node_runs / enrollments / attribution) — those
-- belong to the execution shipment (P3). All future sends go through the EXISTING
-- SMS Mission Control chokepoint (lib/sms/service.ts sendSms/sendBatch); this
-- schema never sends anything.
--
-- Compliance is designed to be REQUIRED, not optional:
--   * automation_templates MUST bind to a real DLT-governed public.sms_templates
--     row (sms_template_id NOT NULL + FK) — a journey can never reference an
--     unapproved / ad-hoc template.
--   * Published workflow versions are IMMUTABLE (enforced by a trigger).
--
-- Service-role only, consistent with sms_logs / payment_action_log: RLS is
-- ENABLED with NO policies, so anon/authed clients get zero rows and zero writes;
-- only the service-role key (server-side, via guarded admin APIs) can read/write.
--
-- ROLLBACK: drop everything created here (see the DROP block at the bottom,
-- commented out). No existing object is touched, so rollback is a clean drop of
-- the automation_* tables + the trigger function.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Workflows — the top-level container. `status` is the lifecycle state machine:
--   draft | ready | active | paused | archived | disabled_by_killswitch
-- current_version_id points at the immutable PUBLISHED version that new entrants
-- would follow once execution ships (nothing runs yet this shipment).
-- ---------------------------------------------------------------------------
create table if not exists public.automation_workflows (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  status              text not null default 'draft'
                        check (status in ('draft','ready','active','paused','archived','disabled_by_killswitch')),
  current_version_id  uuid,                              -- FK added after versions table exists
  published_version   int,                               -- latest published version number (null until first publish)
  killswitch_disabled boolean not null default false,    -- per-workflow disable (global switch lives in automation_settings)
  created_by          text,
  updated_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Workflow versions — IMMUTABLE once published. A published version stores a
-- self-contained `definition` jsonb snapshot (nodes/edges/triggers/goals) so it
-- can never drift even as the draft graph is edited. New entrants run the latest
-- published version; existing entrants stay on the version they started (P3).
-- ---------------------------------------------------------------------------
create table if not exists public.automation_workflow_versions (
  id             uuid primary key default gen_random_uuid(),
  workflow_id    uuid not null references public.automation_workflows(id) on delete cascade,
  version        int  not null,
  status         text not null default 'draft' check (status in ('draft','published','archived')),
  definition     jsonb not null default '{}'::jsonb,     -- frozen snapshot for published versions
  change_summary text,
  created_by     text,                                   -- who authored/edited this version
  published_by   text,
  published_at   timestamptz,
  is_immutable   boolean not null default false,         -- set true on publish; trigger then freezes the row
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workflow_id, version)
);

-- Now that versions exist, point workflows.current_version_id at them.
alter table public.automation_workflows
  drop constraint if exists automation_workflows_current_version_fk;
alter table public.automation_workflows
  add constraint automation_workflows_current_version_fk
  foreign key (current_version_id) references public.automation_workflow_versions(id) on delete set null;

-- Immutability guard: once a version row is published (status='published' OR
-- is_immutable), it can never be UPDATEd or DELETEd. Publishing is done by
-- INSERTing the frozen snapshot (or a single draft->published transition handled
-- in app code before this fires on the published row). Defense-in-depth for the
-- "immutable published versions" invariant, in addition to the app-layer guard.
create or replace function public.automation_freeze_published_version()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    if (old.status = 'published' or old.is_immutable) then
      raise exception 'automation_workflow_versions: published version % (workflow %) is immutable and cannot be deleted', old.version, old.workflow_id;
    end if;
    return old;
  end if;
  -- UPDATE: block any change to an already-frozen row. Allow the one-time
  -- draft -> published transition (old row not yet frozen).
  if (old.status = 'published' or old.is_immutable) then
    raise exception 'automation_workflow_versions: published version % (workflow %) is immutable and cannot be modified', old.version, old.workflow_id;
  end if;
  return new;
end;
$$;

drop trigger if exists automation_freeze_published_version_trg on public.automation_workflow_versions;
create trigger automation_freeze_published_version_trg
  before update or delete on public.automation_workflow_versions
  for each row execute function public.automation_freeze_published_version();

-- ---------------------------------------------------------------------------
-- Draft working graph: nodes + edges scoped to a (workflow, version). These are
-- the editable draft representation; a publish snapshots them into
-- automation_workflow_versions.definition. NOT a runtime table.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_nodes (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.automation_workflows(id) on delete cascade,
  version_id  uuid not null references public.automation_workflow_versions(id) on delete cascade,
  node_key    text not null,                             -- stable key within the graph
  type        text not null,                             -- trigger | wait | send_sms | branch | goal | ...
  config      jsonb not null default '{}'::jsonb,
  position    jsonb not null default '{}'::jsonb,        -- {x,y} for the future visual builder
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (version_id, node_key)
);

create table if not exists public.automation_edges (
  id             uuid primary key default gen_random_uuid(),
  workflow_id    uuid not null references public.automation_workflows(id) on delete cascade,
  version_id     uuid not null references public.automation_workflow_versions(id) on delete cascade,
  source_node_id uuid not null references public.automation_nodes(id) on delete cascade,
  target_node_id uuid not null references public.automation_nodes(id) on delete cascade,
  branch_label   text,                                   -- e.g. 'yes' | 'no' | goal name
  condition      jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers — what enrolls a student into a workflow version. Enabled defaults
-- to FALSE (nothing can enroll/execute this shipment).
-- ---------------------------------------------------------------------------
create table if not exists public.automation_triggers (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.automation_workflows(id) on delete cascade,
  version_id  uuid not null references public.automation_workflow_versions(id) on delete cascade,
  event_type  text not null,                             -- payment_received | installment_overdue | webinar_registered | lead_created | ...
  config      jsonb not null default '{}'::jsonb,
  enabled     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Goals — the desired outcome a workflow optimizes for (conversion / payment).
-- ---------------------------------------------------------------------------
create table if not exists public.automation_goals (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.automation_workflows(id) on delete cascade,
  version_id  uuid not null references public.automation_workflow_versions(id) on delete cascade,
  name        text not null,
  goal_type   text not null,                             -- payment_completed | webinar_attended | ...
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Suppressions — journey-level compliance suppression registry (opt-out / DND /
-- do-not-contact). `reason` is REQUIRED (compliance is never optional). The
-- authoritative send-time opt-out check still lives at the chokepoint; this is an
-- additive journey-scoped registry the engine will also honor.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_suppressions (
  id                uuid primary key default gen_random_uuid(),
  scope             text not null default 'global' check (scope in ('global','workflow')),
  workflow_id       uuid references public.automation_workflows(id) on delete cascade,
  normalized_mobile text not null,
  reason            text not null,                       -- NOT NULL: compliance requires a recorded reason
  created_by        text,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz,
  unique (scope, workflow_id, normalized_mobile)
);

-- ---------------------------------------------------------------------------
-- Journey message templates — MUST bind to a real DLT-governed sms_templates row.
-- This structurally REQUIRES compliance: a journey can only ever reference an
-- approved template that already exists in Mission Control. NOT NULL + FK.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  channel         text not null default 'sms' check (channel in ('sms')),
  sms_template_id text not null references public.sms_templates(id) on delete restrict,
  description     text,
  created_by      text,
  updated_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit log — append-only ledger of create/edit/version/publish/pause/archive
-- with actor + before/after. Append-only by convention (app only INSERT/SELECT).
-- ---------------------------------------------------------------------------
create table if not exists public.automation_audit_logs (
  id             uuid primary key default gen_random_uuid(),
  workflow_id    uuid references public.automation_workflows(id) on delete set null,
  version_id     uuid,
  action         text not null,                          -- create | edit | version | publish | pause | resume | archive | killswitch_on | killswitch_off
  actor_id       text,
  actor_name     text,
  actor_role     text,
  actor_is_super boolean not null default false,
  before         jsonb,
  after          jsonb,
  summary        text,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Settings — single config row incl. the GLOBAL KILL SWITCH surface. This exists
-- BEFORE the engine so the safety control is in place first. It is config, not a
-- runtime table.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_settings (
  id                   text primary key default 'default',
  kill_switch_engaged  boolean not null default false,
  kill_switch_reason   text,
  kill_switch_by       text,
  kill_switch_at       timestamptz,
  data                 jsonb not null default '{}'::jsonb,
  updated_by           text,
  updated_at           timestamptz not null default now()
);

insert into public.automation_settings (id) values ('default')
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists automation_workflows_status_idx        on public.automation_workflows (status);
create index if not exists automation_workflows_updated_idx       on public.automation_workflows (updated_at desc);
create index if not exists automation_versions_workflow_idx       on public.automation_workflow_versions (workflow_id, version desc);
create index if not exists automation_nodes_version_idx           on public.automation_nodes (version_id);
create index if not exists automation_edges_version_idx           on public.automation_edges (version_id);
create index if not exists automation_triggers_version_idx        on public.automation_triggers (version_id);
create index if not exists automation_triggers_event_idx          on public.automation_triggers (event_type);
create index if not exists automation_goals_version_idx           on public.automation_goals (version_id);
create index if not exists automation_suppressions_mobile_idx     on public.automation_suppressions (normalized_mobile);
create index if not exists automation_templates_sms_idx           on public.automation_templates (sms_template_id);
create index if not exists automation_audit_workflow_idx          on public.automation_audit_logs (workflow_id, created_at desc);
create index if not exists automation_audit_action_idx            on public.automation_audit_logs (action, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: enable with NO policies => service-role only (guarded admin APIs).
-- ---------------------------------------------------------------------------
alter table public.automation_workflows          enable row level security;
alter table public.automation_workflow_versions  enable row level security;
alter table public.automation_nodes              enable row level security;
alter table public.automation_edges              enable row level security;
alter table public.automation_triggers           enable row level security;
alter table public.automation_goals              enable row level security;
alter table public.automation_suppressions       enable row level security;
alter table public.automation_templates          enable row level security;
alter table public.automation_audit_logs         enable row level security;
alter table public.automation_settings           enable row level security;

-- ============================================================================
-- ROLLBACK (run manually to fully undo this migration):
--
--   drop trigger if exists automation_freeze_published_version_trg on public.automation_workflow_versions;
--   drop function if exists public.automation_freeze_published_version();
--   drop table if exists public.automation_audit_logs cascade;
--   drop table if exists public.automation_templates cascade;
--   drop table if exists public.automation_suppressions cascade;
--   drop table if exists public.automation_goals cascade;
--   drop table if exists public.automation_triggers cascade;
--   drop table if exists public.automation_edges cascade;
--   drop table if exists public.automation_nodes cascade;
--   drop table if exists public.automation_workflow_versions cascade;
--   drop table if exists public.automation_workflows cascade;
--   drop table if exists public.automation_settings cascade;
--
-- No existing object is modified, so the drop is clean and complete.
-- ============================================================================
