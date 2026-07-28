-- ============================================================================
-- ACCESS AT RISK REMINDER AUTOMATION
-- Cap tracking (5 sequences / student / installment), settings (kill/dry-run),
-- and dry-run would-send log. ADDITIVE. Rollback at the bottom.
-- ============================================================================

-- Per-installment automation counter + needs_call flag.
create table if not exists public.access_reminder_caps (
  id                      uuid primary key default gen_random_uuid(),
  course_enrollment_id    text not null,
  installment_no          integer not null,
  installment_fingerprint text,
  student_id              text,
  normalized_mobile       text,
  auto_sequences_used     integer not null default 0,
  needs_call              boolean not null default false,
  needs_call_at           timestamptz,
  excluded_from_automation boolean not null default false,
  excluded_reason         text,
  excluded_by             text,
  excluded_at             timestamptz,
  -- Cap reset (logged reason) — only for genuine staff override.
  reset_at                timestamptz,
  reset_by                text,
  reset_reason            text,
  last_auto_sent_at       timestamptz,
  first_blocked_seen_at   timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (course_enrollment_id, installment_no)
);

create index if not exists access_reminder_caps_needs_call_idx
  on public.access_reminder_caps (needs_call) where needs_call = true;

create index if not exists access_reminder_caps_student_idx
  on public.access_reminder_caps (student_id) where student_id is not null;

-- Singleton settings row (id = 1). Defaults = SAFE ship state.
create table if not exists public.access_reminder_settings (
  id              integer primary key default 1 check (id = 1),
  kill_switch     boolean not null default false,
  dry_run         boolean not null default true,
  enabled         boolean not null default false,
  ramp_limit      integer not null default 10,
  daily_ceiling   integer not null default 200,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

insert into public.access_reminder_settings (id) values (1)
  on conflict (id) do nothing;

-- Dry-run / audit of what automation WOULD send (or did send).
create table if not exists public.access_reminder_automation_runs (
  id              uuid primary key default gen_random_uuid(),
  run_at          timestamptz not null default now(),
  dry_run         boolean not null,
  kill_switch     boolean not null,
  enabled         boolean not null,
  would_send      integer not null default 0,
  excluded        integer not null default 0,
  sent            integer not null default 0,
  halted_reason   text,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- drop table if exists public.access_reminder_automation_runs;
-- drop table if exists public.access_reminder_settings;
-- drop table if exists public.access_reminder_caps;
-- ---------------------------------------------------------------------------
