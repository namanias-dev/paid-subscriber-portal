-- ============================================================================
-- Journey Automation — EVENT-CAPTURE SPIKE (Phase 2, Part A). ADDITIVE ONLY.
--
-- One new append-only table `automation_events` that INGESTS representative
-- business events (payment_received, installment_overdue, webinar_registered).
-- NOTHING consumes these rows this shipment: no trigger matching, no execution,
-- no sending. This only proves capture + shape for the future engine (P3).
--
-- Follows the sms_logs insert-first UNIQUE-dedupe pattern: a partial unique index
-- on `dedupe_key` makes concurrent/duplicate ingests idempotent (insert-and-
-- catch-conflict). Service-role only: RLS enabled, no policies (matches sms_logs).
--
-- ROLLBACK: drop table public.automation_events (see bottom). No existing object
-- is touched.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.automation_events (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null,                          -- payment_received | installment_overdue | webinar_registered | ...
  occurred_at   timestamptz not null default now(),
  -- Subject references (all optional; an event names whoever/whatever it concerns).
  student_id    text,
  lead_id       text,
  enrollment_id text,
  webinar_id    text,
  payment_id    text,
  phone         text,
  payload       jsonb not null default '{}'::jsonb,     -- non-sensitive shape only; NEVER login codes/secrets
  dedupe_key    text,                                   -- UNIQUE-when-present => idempotent ingest
  source        text not null default 'system',         -- payment | webinar | cron | ...
  created_at    timestamptz not null default now()
);

-- Hard idempotency guarantee (mirrors sms_logs_dedupe_key_uq).
create unique index if not exists automation_events_dedupe_uq
  on public.automation_events (dedupe_key) where dedupe_key is not null;

create index if not exists automation_events_type_idx
  on public.automation_events (event_type, occurred_at desc);
create index if not exists automation_events_occurred_idx
  on public.automation_events (occurred_at desc);
create index if not exists automation_events_phone_idx
  on public.automation_events (phone, occurred_at desc);
create index if not exists automation_events_enrollment_idx
  on public.automation_events (enrollment_id);

-- RLS: enable with NO policies => service-role only (guarded server code).
alter table public.automation_events enable row level security;

-- ============================================================================
-- ROLLBACK (run manually to fully undo this migration):
--   drop table if exists public.automation_events cascade;
-- No existing object is modified, so the drop is clean and complete.
-- ============================================================================
