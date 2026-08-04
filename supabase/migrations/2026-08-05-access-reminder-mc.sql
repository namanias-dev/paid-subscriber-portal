-- ============================================================================
-- Stage 1: Mission Control installment access reminders + unified event log
-- Additive only. No sends from these tables alone (armed flag / rule.enabled gate).
-- ============================================================================

-- Append-only student access action / system-send log → profile timeline.
create table if not exists public.student_access_events (
  id                  uuid primary key default gen_random_uuid(),
  student_id          text,
  phone               text not null,
  course_id           text,
  course_enrollment_id text,
  event_type          text not null
    check (event_type in (
      'reminder_sent', 'reminder_failed',
      'extension_granted', 'extension_revoked', 'extension_expired',
      'call_task_created', 'access_blocked', 'access_restored'
    )),
  actor               text not null default 'system',
  channel             text,
  template_id         text,
  body_sent           text,
  amount              numeric,
  installment_no      integer,
  reason              text,
  related_event_id    text,
  meta                jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists student_access_events_phone_idx
  on public.student_access_events (phone, created_at desc);
create index if not exists student_access_events_student_idx
  on public.student_access_events (student_id, created_at desc)
  where student_id is not null;
create index if not exists student_access_events_type_idx
  on public.student_access_events (event_type, created_at desc);

comment on table public.student_access_events is
  'Unified access/reminder event log. Actor system = automation; otherwise admin username.';

-- Consecutive daily reminder streak (cap 10 → call task). Separate from
-- access_reminder_caps (ACCESS_AUTO_CAP_PER_INSTALLMENT=5) and installment_ladder_events.
create table if not exists public.installment_reminder_streaks (
  course_enrollment_id  text not null,
  installment_no        integer not null,
  consecutive_days      integer not null default 0,
  last_sent_ymd         text,
  paused                boolean not null default false,
  pause_reason          text,
  call_task_created     boolean not null default false,
  updated_at            timestamptz not null default now(),
  primary key (course_enrollment_id, installment_no)
);

comment on table public.installment_reminder_streaks is
  'Daily-until-paid streak for MC installment_access_reminder. Cap 10 consecutive days → call task. Independent of ACCESS_AUTO_CAP_PER_INSTALLMENT.';

-- Grandfather notice pilot / queue (unarmed until staff arms).
create table if not exists public.grandfather_notice_queue (
  course_enrollment_id  text primary key,
  student_name          text,
  phone                 text not null,
  installment_no        integer,
  amount_due            numeric,
  pct_paid              numeric,
  cohort                text not null default 'queued_53'
    check (cohort in ('pilot_10', 'queued_53', 'classic_grace_10')),
  armed                 boolean not null default false,
  scheduled_for_ymd     text,
  schedule_time_ist     text default '11:00',
  sent_at               timestamptz,
  stage1_log_id         text,
  stage3_log_id         text,
  meta                  jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists grandfather_notice_queue_cohort_idx
  on public.grandfather_notice_queue (cohort, armed);

comment on table public.grandfather_notice_queue is
  '5 Aug grandfather notice pilot (10) + remaining 53 queued. Nothing sends while armed=false.';

alter table public.student_access_events enable row level security;
alter table public.installment_reminder_streaks enable row level security;
alter table public.grandfather_notice_queue enable row level security;

-- Rollback:
-- drop table if exists public.grandfather_notice_queue;
-- drop table if exists public.installment_reminder_streaks;
-- drop table if exists public.student_access_events;
