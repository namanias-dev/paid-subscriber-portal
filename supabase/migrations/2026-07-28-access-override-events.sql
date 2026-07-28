-- Audit log for access grants / revokes (timeline + leakage report).
create table if not exists public.access_override_events (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,
  course_id   text not null,
  actor       text,
  kind        text not null check (kind in ('granted','revoked','shortened','expired')),
  detail      text,
  reason      text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists access_override_events_phone_idx
  on public.access_override_events (phone, created_at desc);

-- Optional reason column on caps (already using excluded_reason for flag text).
alter table public.access_reminder_caps
  add column if not exists flag_reason text;

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- drop table if exists public.access_override_events;
-- alter table public.access_reminder_caps drop column if exists flag_reason;
-- ---------------------------------------------------------------------------
