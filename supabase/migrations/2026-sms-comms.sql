-- ============================================================================
-- In-portal SMS Communications + Mission Control (ADDITIVE — breaks nothing).
-- Pabbly stays live; this is a parallel, in-house send layer.
--
-- Tables: sms_templates, sms_logs, sms_auto_rules, sms_settings.
-- Service-role only (all access via guarded admin API routes), consistent with
-- analytics_events. The PARTIAL UNIQUE index on sms_logs.dedupe_key is the hard
-- anti-double-send guarantee (insert-first-then-send across serverless triggers).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Templates (DLT-governed). Seeded as DRAFT/INACTIVE by the app; bodies must
-- byte-match /docs/sms-dlt-templates.md.
-- ---------------------------------------------------------------------------
create table if not exists public.sms_templates (
  id                 text primary key,                 -- stable key, e.g. 'payment_pending'
  name               text not null,
  use_case           text not null,                    -- PAYMENT | WEBINAR | POST_WEBINAR | ONBOARDING
  gateway_template_id text,                            -- DLT Template ID (blank until pasted)
  sender_id          text not null default 'NAMIAS',
  route              text not null default '12',
  message_type       text not null default 'service',  -- service | promotional
  body_template      text not null,
  variables          text[] not null default '{}',
  status             text not null default 'draft',     -- draft|pending|approved|active|inactive
  is_active          boolean not null default false,
  auto_send_enabled  boolean not null default false,
  trigger_event      text,
  audience_type      text,
  created_by         text,
  updated_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Logs (every attempt). dedupe_key UNIQUE-when-present prevents double-send.
-- ---------------------------------------------------------------------------
create table if not exists public.sms_logs (
  id                 uuid primary key default gen_random_uuid(),
  mobile             text not null,
  normalized_mobile  text not null,
  student_name       text,
  user_id            text,
  lead_id            text,
  registration_id    text,
  payment_id         text,
  course_id          text,
  webinar_id         text,
  template_id        text,
  template_name      text,
  gateway_template_id text,
  sender_id          text,
  route              text,
  message_body       text not null,
  character_count    int,
  segments           int,
  status             text not null default 'QUEUED',    -- QUEUED|SENT|FAILED|DELIVERED|UNKNOWN
  gateway_response   jsonb,
  gateway_message_id text,
  sent_by_user_id    text,
  sent_by_type       text not null default 'SYSTEM',    -- ADMIN | SYSTEM
  trigger_event      text,
  audience_type      text,
  dedupe_key         text,
  error_message      text,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz
);

create unique index if not exists sms_logs_dedupe_key_uq
  on public.sms_logs (dedupe_key) where dedupe_key is not null;
create index if not exists sms_logs_created_idx   on public.sms_logs (created_at desc);
create index if not exists sms_logs_mobile_idx    on public.sms_logs (normalized_mobile, created_at desc);
create index if not exists sms_logs_template_idx  on public.sms_logs (template_id, created_at desc);
create index if not exists sms_logs_status_idx    on public.sms_logs (status);
create index if not exists sms_logs_trigger_idx   on public.sms_logs (trigger_event, created_at desc);

-- ---------------------------------------------------------------------------
-- Auto rules (trigger -> template). ALL default disabled.
-- ---------------------------------------------------------------------------
create table if not exists public.sms_auto_rules (
  trigger       text primary key,                       -- e.g. 'payment_success'
  template_id   text references public.sms_templates(id) on delete set null,
  enabled       boolean not null default false,
  delay_minutes int,
  schedule_time text,                                   -- "HH:MM" IST for cron jobs
  offset_minutes int,                                   -- T19 end+offset
  audience_type text,
  last_run_at   timestamptz,
  updated_by    text,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Settings (single row). Mutable knobs; secrets NEVER stored here.
-- ---------------------------------------------------------------------------
create table if not exists public.sms_settings (
  id         text primary key default 'default',
  data       jsonb not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.sms_templates  enable row level security;
alter table public.sms_logs        enable row level security;
alter table public.sms_auto_rules  enable row level security;
alter table public.sms_settings    enable row level security;
-- No policies => only the service role (used by guarded admin APIs) can read/write.
