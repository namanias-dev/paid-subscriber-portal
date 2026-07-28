-- Batch / course transfer: history table + the one atomic mutation.
--
-- The transfer itself lives in a plpgsql function because it is several writes
-- that must succeed or fail together. The JS client cannot hold a transaction
-- across statements, so doing this from the route would risk exactly the failure
-- the brief calls the worst outcome: a batch moved with its installments left
-- behind. Inside a function, any exception rolls the whole thing back.

create table if not exists public.enrollment_transfers (
  id            uuid primary key default gen_random_uuid(),

  -- the row that was moved, and the row that replaced it
  from_enrollment_id text not null references public.course_enrollments(id) on delete restrict,
  to_enrollment_id   text not null references public.course_enrollments(id) on delete restrict,

  student_phone text not null,
  student_name  text,

  -- where it went from and to. Course and batch are both captured because a
  -- transfer may change either or both.
  from_course_id   text not null,
  from_course_title text,
  from_batch_id    text,
  from_batch_label text,
  to_course_id     text not null,
  to_course_title  text,
  to_batch_id      text,
  to_batch_label   text,

  -- the money, frozen at the moment of transfer, so the history is readable
  -- without having to reconstruct it from two enrollment rows
  old_total_fee  integer not null,
  new_total_fee  integer not null,
  amount_paid    integer not null,
  fee_delta      integer not null,
  credit_due     integer not null default 0,

  -- the schedules on both sides, so a dispute can be settled from this row alone
  old_schedule jsonb not null,
  new_schedule jsonb not null,
  shift_days   integer,

  reason        text not null,
  actor_user_id text,
  actor_type    text not null default 'ADMIN',
  /** Set when a senior admin pushed past a full target batch. */
  capacity_overridden boolean not null default false,

  created_at timestamptz not null default now()
);

create index if not exists enrollment_transfers_from_idx on public.enrollment_transfers (from_enrollment_id);
create index if not exists enrollment_transfers_to_idx   on public.enrollment_transfers (to_enrollment_id);
create index if not exists enrollment_transfers_phone_idx on public.enrollment_transfers (student_phone, created_at desc);

comment on table public.enrollment_transfers is
  'One row per batch/course transfer. The old enrollment is superseded, never deleted, and this row is the link between the two.';

-- ---------------------------------------------------------------------------
-- The atomic transfer.
--
-- Supersede-and-replace rather than update-in-place: the old row stays exactly as
-- it was except for its status and superseded_by pointer, so attendance, results
-- and any receipt that references it keep pointing at a row that still describes
-- the batch the student actually sat in. The new row carries the money forward.
--
-- Returns the new enrollment id. Raises on any inconsistency, which rolls back
-- every write including the seat adjustments.
-- ---------------------------------------------------------------------------
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
  p_expected_amount_paid integer
) returns text
language plpgsql
as $$
declare
  src public.course_enrollments%rowtype;
  -- course_enrollments.id is text with no default, so the id is generated here
  -- rather than relying on one.
  new_id text := gen_random_uuid()::text;
  paid_sum integer;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a transfer requires a reason';
  end if;

  -- Lock the source row for the duration. A concurrent transfer of the same
  -- enrollment waits here and then fails the superseded check below, so the same
  -- student cannot be moved twice into two different batches.
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

  -- The caller computed the plan from a snapshot. If the money moved since then,
  -- that plan is stale and committing it would write a figure a human never saw.
  if src.amount_paid is distinct from p_expected_amount_paid then
    raise exception 'amount_paid changed from % to % while the transfer was being reviewed',
      p_expected_amount_paid, src.amount_paid;
  end if;

  -- Money must survive the move: what the new schedule marks paid has to equal
  -- what the student has actually paid.
  select coalesce(sum((line->>'amount')::integer), 0) into paid_sum
    from jsonb_array_elements(p_new_schedule) line
   where coalesce((line->>'paid')::boolean, false);
  if paid_sum is distinct from src.amount_paid then
    raise exception 'new schedule accounts for % paid but the enrollment has % paid', paid_sum, src.amount_paid;
  end if;

  -- 1. the replacement row, carrying the money forward.
  --
  -- payment_plan_changed_at is set deliberately. A transfer reschedules unpaid due
  -- dates, which changes every affected line's fingerprint. Recording the moment
  -- means reminder attribution reports an honest 'plan changed' rather than
  -- falling through to the ordinal and re-pointing an old reminder at a line it
  -- was never about.
  -- Everything not named here is deliberately NOT carried over: the plan-change
  -- columns describe events on the old row, and a discount negotiated for one
  -- batch is not automatically a discount on another.
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

  -- 2. supersede the original. Status records WHY it is inactive; the pointer
  --    records where the student went.
  update public.course_enrollments
     set status = 'transferred_out',
         superseded_by = new_id,
         updated_at = now()
   where id = p_enrollment_id;

  -- 3. seat accounting, only where the catalog actually tracks seats
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

  -- 4. the history row
  insert into public.enrollment_transfers (
    from_enrollment_id, to_enrollment_id, student_phone, student_name,
    from_course_id, from_course_title, from_batch_id, from_batch_label,
    to_course_id, to_course_title, to_batch_id, to_batch_label,
    old_total_fee, new_total_fee, amount_paid, fee_delta, credit_due,
    old_schedule, new_schedule, shift_days,
    reason, actor_user_id, capacity_overridden
  ) values (
    p_enrollment_id, new_id, src.phone, src.student_name,
    src.course_id, src.course_title, src.batch_id, src.batch_label,
    p_to_course_id, p_to_course_title, p_to_batch_id, p_to_batch_label,
    src.total_fee, p_new_total_fee, src.amount_paid, p_new_total_fee - src.total_fee,
    greatest(0, src.amount_paid - p_new_total_fee),
    coalesce(src.schedule, '[]'::jsonb), p_new_schedule, p_shift_days,
    p_reason, p_actor_user_id, coalesce(p_capacity_overridden, false)
  );

  return new_id;
end;
$$;

comment on function public.transfer_enrollment is
  'Atomically supersede an enrollment and replace it in a new course/batch. All-or-nothing: any raise rolls back the new row, the supersession, the seat counts and the history row together.';
