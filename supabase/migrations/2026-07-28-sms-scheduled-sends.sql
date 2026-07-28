-- ============================================================================
-- SCHEDULED FOLLOW-UP SENDS — the durable half of a two-step SMS sequence.
--
-- WHY A TABLE AND NOT A TIMER. The follow-up fires 30 minutes after the
-- reminder. A setTimeout lives in one serverless invocation: the function
-- returns, the sandbox is frozen, a deploy replaces it — and the follow-up
-- silently never happens, with no record that it was ever owed. A row survives
-- all three, and a drain that finds it late still sends it.
--
-- WHY NOT THE JOURNEY ENGINE'S automation_jobs. That queue is the runtime of a
-- workflow engine: a job there means "execute node N of published graph G for
-- enrollment E", and its sends are deliberately gated behind execution_mode,
-- per-category flags and a kill switch that all default to OFF. Borrowing it
-- would either mean fabricating a workflow per reminder or flipping global
-- journey flags to make one transactional SMS go out — which would also arm
-- every other workflow. This queue is smaller and unconditional: one row = one
-- named template to one number about one installment.
--
-- ADDITIVE. No existing table or column is touched. Rollback at the bottom.
-- ============================================================================

create table if not exists public.sms_scheduled_sends (
  id            uuid primary key default gen_random_uuid(),

  -- WHAT goes out. A template id, never a body: the body is rendered at send
  -- time through the same path every other send uses, so the DLT-approved text
  -- cannot be captured here and then drift from the registration.
  template_id   text not null,

  -- WHO. normalized_mobile is the send target; the rest is audit/display.
  normalized_mobile text not null,
  student_name  text,
  student_id    text,
  course_id     text,

  -- WHICH INSTALLMENT. Exactly the composite key already carried by sms_logs.
  -- Installments are JSONB array elements in course_enrollments.schedule with
  -- no id of their own, so identity is (enrollment, ordinal) plus an immutable
  -- fingerprint that survives a plan renumbering. Same scheme, no second one.
  course_enrollment_id    text not null,
  installment_no          integer not null,
  installment_fingerprint text,

  -- LINEAGE. The step-1 log this follows. A follow-up only ever exists because
  -- a reminder actually went out, and this is the proof of which one.
  parent_send_id uuid not null references public.sms_logs(id) on delete cascade,
  -- Groups a bulk job's follow-ups exactly as campaign_id groups its sends.
  job_id        text,

  scheduled_at  timestamptz not null,
  status        text not null default 'pending'
                  check (status in ('pending','claimed','sent','cancelled','failed')),
  attempts      integer not null default 0,
  max_attempts  integer not null default 3,
  last_error    text,
  -- Why a follow-up did NOT go out. Always set when status='cancelled', so the
  -- UI never has to show an unexplained cancellation.
  cancel_reason text,

  -- The actor who triggered step 1 owns the follow-up too.
  actor_user_id text,
  actor_type    text not null default 'ADMIN',

  -- The step-2 sms_logs row, once sent. Nullable until then.
  sent_log_id   uuid,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  finished_at   timestamptz
);

-- ONE FOLLOW-UP PER (student's installment, template, parent send). This is the
-- structural half of "a job can only ever send once": a duplicate schedule
-- attempt — double-clicked button, replayed bulk job, retried request — cannot
-- create a second row. The other half is the deterministic dedupe_key on the
-- send itself, so even a doubly-claimed row cannot produce two messages.
create unique index if not exists sms_scheduled_sends_once_uq
  on public.sms_scheduled_sends (course_enrollment_id, installment_no, template_id, parent_send_id);

-- The drain's only query: due and still pending, oldest first.
create index if not exists sms_scheduled_sends_due_idx
  on public.sms_scheduled_sends (scheduled_at)
  where status = 'pending';

-- Powers the per-row pill and the pending-follow-ups panel without a scan.
create index if not exists sms_scheduled_sends_enrollment_idx
  on public.sms_scheduled_sends (course_enrollment_id, installment_no);

create index if not exists sms_scheduled_sends_job_idx
  on public.sms_scheduled_sends (job_id) where job_id is not null;

-- ---------------------------------------------------------------------------
-- Atomic claim (FOR UPDATE SKIP LOCKED) — two overlapping drains cannot take
-- the same row, so "the worker ran twice" produces one send, not two. Modelled
-- on public.automation_claim_jobs so there is one claim idiom in the codebase.
-- ---------------------------------------------------------------------------
create or replace function public.sms_scheduled_claim(p_limit int)
returns setof public.sms_scheduled_sends
language plpgsql as $$
begin
  return query
  update public.sms_scheduled_sends s
     set status = 'claimed', attempts = s.attempts + 1, claimed_at = now(), updated_at = now()
   where s.id in (
     select id from public.sms_scheduled_sends
      where status = 'pending' and scheduled_at <= now()
      order by scheduled_at asc
      for update skip locked
      limit p_limit
   )
  returning s.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- Crash recovery: a drain that died after claiming leaves rows stuck in
-- 'claimed'. Put them back so the next tick picks them up. Without this a
-- killed process would strand exactly the follow-ups it had in flight.
-- ---------------------------------------------------------------------------
create or replace function public.sms_scheduled_requeue_stale(p_older_than_seconds int)
returns integer
language plpgsql as $$
declare
  n integer;
begin
  update public.sms_scheduled_sends
     set status = 'pending', updated_at = now(), claimed_at = null
   where status = 'claimed'
     and claimed_at < now() - make_interval(secs => p_older_than_seconds);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Service-role only: written by guarded server code and the cron, never by a
-- browser. Enabled with no policies, exactly as the automation tables are.
alter table public.sms_scheduled_sends enable row level security;

-- ============================================================================
-- ROLLBACK (run manually to fully undo this migration):
--   drop function if exists public.sms_scheduled_requeue_stale(int);
--   drop function if exists public.sms_scheduled_claim(int);
--   drop table if exists public.sms_scheduled_sends cascade;
-- No business object is touched, so rollback is clean and complete.
-- ============================================================================
