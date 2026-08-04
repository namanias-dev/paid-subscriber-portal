-- ============================================================================
-- INSTALMENT FOLLOW-UP LADDER (−7/−3/due/+3/+7)
-- Separate from access_reminder_caps (ACCESS_AUTO_CAP_PER_INSTALLMENT).
-- Additive, reversible. No sends happen from this table alone.
-- ============================================================================

create table if not exists public.installment_ladder_events (
  id                    uuid primary key default gen_random_uuid(),
  course_enrollment_id  text not null,
  installment_no        integer not null,
  step                  text not null
    check (step in ('m7', 'm3', 'd0', 'p3', 'p7_call')),
  channel               text not null default 'sms'
    check (channel in ('sms', 'call_task', 'none')),
  template_id           text,
  body_snapshot         text,
  dry_run               boolean not null default true,
  fired_at              timestamptz not null default now(),
  unique (course_enrollment_id, installment_no, step)
);

create index if not exists installment_ladder_events_enr_idx
  on public.installment_ladder_events (course_enrollment_id);

create index if not exists installment_ladder_events_fired_idx
  on public.installment_ladder_events (fired_at desc);

comment on table public.installment_ladder_events is
  'Idempotent instalment ladder steps (−7/−3/due/+3/+7). Cap of 5 here is ladder steps, not access SMS auto-cap.';

-- Collection call tasks for +7d (not journey automation enrollments).
create table if not exists public.collections_call_tasks (
  id                    uuid primary key default gen_random_uuid(),
  course_enrollment_id  text not null,
  installment_no        integer,
  student_name          text,
  phone                 text,
  amount_due            numeric,
  days_overdue          integer,
  reason                text not null default 'ladder_p7',
  status                text not null default 'open'
    check (status in ('open', 'done', 'dismissed')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (course_enrollment_id, installment_no, reason)
);

create index if not exists collections_call_tasks_status_idx
  on public.collections_call_tasks (status, created_at desc);

-- Rollback:
-- drop table if exists public.collections_call_tasks;
-- drop table if exists public.installment_ladder_events;
