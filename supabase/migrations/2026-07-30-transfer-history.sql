-- Visible event history for transfers.
--
-- This EXTENDS the enrollment_transfers row the transfer already writes rather
-- than adding a second log. That row is created inside transfer_enrollment(), so
-- history is already all-or-nothing with the transfer itself; what it lacked was
-- a structured before/after snapshot and a human name for the actor.
--
-- The snapshot is stored as structured JSON, never a formatted sentence, so the
-- UI can render it differently later without rewriting history.

alter table public.enrollment_transfers
  -- The staff member's display name AS IT WAS when they acted. Resolved at write
  -- time on purpose: if someone is renamed or leaves, the record of who did this
  -- must not change underneath it.
  add column if not exists actor_name text,
  -- Full before/after: course, batch, batch start, fee, paid, outstanding,
  -- schedule, seat counts and content-access counts.
  add column if not exists snapshot jsonb;

comment on column public.enrollment_transfers.snapshot is
  'Structured before/after state captured at transfer time. Never a formatted string — the UI formats at render.';

-- The timeline reads by student, newest first. enrollment_transfers_phone_idx
-- already covers (student_phone, created_at desc), so no new index is needed.

-- ---------------------------------------------------------------------------
-- Append-only.
--
-- A correction is a new event, never an edit. Enforced in the database rather
-- than in the route, because "no admin can change this" has to survive someone
-- writing a new route later.
-- ---------------------------------------------------------------------------
create or replace function public.enrollment_transfers_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'enrollment_transfers is append-only: history cannot be % (attempted on id %)',
    lower(tg_op), coalesce(old.id::text, '?');
end;
$$;

drop trigger if exists enrollment_transfers_no_update on public.enrollment_transfers;
create trigger enrollment_transfers_no_update
  before update on public.enrollment_transfers
  for each row execute function public.enrollment_transfers_append_only();

drop trigger if exists enrollment_transfers_no_delete on public.enrollment_transfers;
create trigger enrollment_transfers_no_delete
  before delete on public.enrollment_transfers
  for each row execute function public.enrollment_transfers_append_only();

-- Replace the previous signature entirely. Postgres keeps overloads if arity
-- differs, and the route would then call the old one that ignores the snapshot.
drop function if exists public.transfer_enrollment(
  text, text, text, text, text, text, integer, jsonb, integer, text, text, boolean, integer
);

-- Extend transfer_enrollment so the history snapshot and actor name land in
-- the same transaction as the supersession. Signature gains two trailing
-- optional-style args; callers that omit them still work via DEFAULT null.
create or replace function public.transfer_enrollment(
  p_enrollment_id   text,
  p_to_course_id    text,
  p_to_course_slug  text,
  p_to_course_title text,
  p_to_batch_id     text,
  p_to_batch_label  text,
  p_new_total_fee   integer,
  p_new_schedule    jsonb,
  p_shift_days      integer,
  p_reason          text,
  p_actor_user_id   text,
  p_capacity_overridden boolean,
  p_expected_amount_paid integer,
  p_actor_name      text default null,
  p_snapshot        jsonb default null
) returns text
language plpgsql
as $$
declare
  src public.course_enrollments%rowtype;
  new_id text := gen_random_uuid()::text;
  paid_sum integer;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a transfer requires a reason';
  end if;

  select * into src from public.course_enrollments where id = p_enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id;
  end if;
  if src.superseded_by is not null then
    raise exception 'enrollment % was already superseded by %', p_enrollment_id, src.superseded_by;
  end if;
  if lower(coalesce(src.status,'')) in ('cancelled','refunded') then
    raise exception 'enrollment % is % and cannot be transferred', p_enrollment_id, src.status;
  end if;

  if src.amount_paid is distinct from p_expected_amount_paid then
    raise exception 'amount_paid changed from % to % while the transfer was being reviewed',
      p_expected_amount_paid, src.amount_paid;
  end if;

  select coalesce(sum((line->>'amount')::integer), 0) into paid_sum
    from jsonb_array_elements(p_new_schedule) line
   where coalesce((line->>'paid')::boolean, false);
  if paid_sum is distinct from src.amount_paid then
    raise exception 'new schedule accounts for % paid but the enrollment has % paid', paid_sum, src.amount_paid;
  end if;

  insert into public.course_enrollments (
    id, phone, student_name, email,
    course_id, course_slug, course_title,
    batch_label, batch_id, batch_id_source,
    plan_type, payment_plan, installment_count,
    total_fee, amount_paid, schedule, status,
    payment_plan_changed_at, payment_plan_changed_by, payment_plan_change_reason,
    created_at, updated_at
  )
  values (
    new_id, src.phone, src.student_name, src.email,
    p_to_course_id, p_to_course_slug, p_to_course_title,
    p_to_batch_label, p_to_batch_id, 'transfer',
    src.plan_type, src.payment_plan, src.installment_count,
    p_new_total_fee, src.amount_paid, p_new_schedule, src.status,
    now(), p_actor_user_id, 'Batch/course transfer: ' || p_reason,
    now(), now()
  );

  update public.course_enrollments
     set status = 'transferred_out',
         superseded_by = new_id,
         updated_at = now()
   where id = p_enrollment_id;

  update public.courses c
     set batches = (
       select jsonb_agg(
         case when b->>'id' = p_to_batch_id and (b->>'seats_left') is not null
              then jsonb_set(b, '{seats_left}', to_jsonb(greatest(0, (b->>'seats_left')::int - 1)))
              else b end)
       from jsonb_array_elements(c.batches) b)
   where c.id = p_to_course_id and c.batches is not null;

  update public.courses c
     set batches = (
       select jsonb_agg(
         case when b->>'id' = src.batch_id and (b->>'seats_left') is not null
              then jsonb_set(b, '{seats_left}', to_jsonb((b->>'seats_left')::int + 1))
              else b end)
       from jsonb_array_elements(c.batches) b)
   where c.id = src.course_id and src.batch_id is not null and c.batches is not null;

  insert into public.enrollment_transfers (
    from_enrollment_id, to_enrollment_id, student_phone, student_name,
    from_course_id, from_course_title, from_batch_id, from_batch_label,
    to_course_id, to_course_title, to_batch_id, to_batch_label,
    old_total_fee, new_total_fee, amount_paid, fee_delta, credit_due,
    old_schedule, new_schedule, shift_days,
    reason, actor_user_id, actor_name, capacity_overridden, snapshot
  ) values (
    p_enrollment_id, new_id, src.phone, src.student_name,
    src.course_id, src.course_title, src.batch_id, src.batch_label,
    p_to_course_id, p_to_course_title, p_to_batch_id, p_to_batch_label,
    src.total_fee, p_new_total_fee, src.amount_paid, p_new_total_fee - src.total_fee,
    greatest(0, src.amount_paid - p_new_total_fee),
    coalesce(src.schedule, '[]'::jsonb), p_new_schedule, p_shift_days,
    p_reason, p_actor_user_id, p_actor_name, coalesce(p_capacity_overridden, false), p_snapshot
  );

  return new_id;
end;
$$;

comment on function public.transfer_enrollment is
  'Atomically supersede an enrollment and replace it in a new course/batch. History snapshot and actor name are written in the same transaction.';
